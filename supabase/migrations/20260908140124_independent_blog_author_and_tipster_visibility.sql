alter table public.tipsters
  add column if not exists is_public boolean not null default false;

update public.tipsters
set is_public = true
where is_verified = true
  and is_public = false;

create index if not exists tipsters_public_directory_idx
on public.tipsters (ranking nulls last, display_name)
where is_verified = true and is_public = true;

create table if not exists public.blog_author_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'revoked')),
  request_reason text not null
    check (char_length(btrim(request_reason)) between 10 and 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
    check (review_note is null or char_length(btrim(review_note)) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_author_requests_review_idx
on public.blog_author_requests (status, updated_at desc);

drop trigger if exists set_blog_author_requests_updated_at
on public.blog_author_requests;

create trigger set_blog_author_requests_updated_at
before update on public.blog_author_requests
for each row execute function public.set_updated_at();

alter table public.blog_author_requests enable row level security;

drop policy if exists blog_author_requests_read_own_or_admin
on public.blog_author_requests;

create policy blog_author_requests_read_own_or_admin
on public.blog_author_requests for select
to authenticated
using (
  user_id = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

revoke all on public.blog_author_requests from anon, authenticated;
grant select on public.blog_author_requests to authenticated;

create or replace function app_private.ensure_blog_author_profile(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid;
begin
  insert into public.tipsters (
    user_id,
    display_name,
    biography,
    is_verified,
    is_public
  )
  select
    users.id,
    coalesce(
      nullif(btrim(profiles.display_name), ''),
      nullif(split_part(users.email, '@', 1), ''),
      'MRC Author'
    ),
    null,
    false,
    false
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  where users.id = target_user_id
  on conflict (user_id) do nothing
  returning id into tipster_id_value;

  if tipster_id_value is null then
    select id into tipster_id_value
    from public.tipsters
    where user_id = target_user_id;
  end if;

  if tipster_id_value is null then
    raise exception 'User not found.';
  end if;

  return tipster_id_value;
end;
$$;

create or replace function app_private.current_blog_tipster_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tipsters.id
  from public.tipsters
  where tipsters.user_id = (select auth.uid())
    and app_private.current_user_account_active()
  limit 1;
$$;

create or replace function app_private.current_tipster_can_publish_blog()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tipsters
    join public.tipster_blog_permissions permissions
      on permissions.tipster_id = tipsters.id
    where tipsters.user_id = (select auth.uid())
      and permissions.can_publish = true
      and app_private.current_user_account_active()
  );
$$;

create or replace function public.get_my_blog_author_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select jsonb_build_object(
    'requestId', requests.id,
    'status', case
      when coalesce(permissions.can_publish, false) then 'approved'
      else coalesce(requests.status, 'not_requested')
    end,
    'requestReason', requests.request_reason,
    'reviewNote', requests.review_note,
    'requestedAt', requests.created_at,
    'reviewedAt', requests.reviewed_at,
    'tipsterId', tipsters.id,
    'canPublish', coalesce(permissions.can_publish, false)
      and app_private.account_is_active(current_user_id),
    'displayName', coalesce(
      nullif(btrim(tipsters.display_name), ''),
      nullif(btrim(profiles.display_name), ''),
      nullif(split_part(users.email, '@', 1), ''),
      'MRC Author'
    )
  )
  into result
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  left join public.blog_author_requests requests on requests.user_id = users.id
  left join public.tipsters tipsters on tipsters.user_id = users.id
  left join public.tipster_blog_permissions permissions
    on permissions.tipster_id = tipsters.id
  where users.id = current_user_id;

  return result;
end;
$$;

create or replace function public.request_blog_author_access(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_row public.blog_author_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not app_private.account_is_active(current_user_id) then
    raise exception 'This account is currently restricted.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
    raise exception 'Explain your request in 10 to 1000 characters.';
  end if;

  if exists (
    select 1
    from public.tipsters tipsters
    join public.tipster_blog_permissions permissions
      on permissions.tipster_id = tipsters.id
    where tipsters.user_id = current_user_id
      and permissions.can_publish = true
  ) then
    raise exception 'Blog author access is already approved.';
  end if;

  insert into public.blog_author_requests (
    user_id,
    status,
    request_reason,
    reviewed_by,
    reviewed_at,
    review_note
  )
  values (
    current_user_id,
    'requested',
    btrim(p_reason),
    null,
    null,
    null
  )
  on conflict (user_id) do update
  set
    status = 'requested',
    request_reason = excluded.request_reason,
    reviewed_by = null,
    reviewed_at = null,
    review_note = null
  returning * into request_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id,
    'blog_author_access_requested',
    'blog_author_request',
    request_row.id,
    jsonb_build_object('reason', request_row.request_reason)
  );

  return to_jsonb(request_row);
end;
$$;

create or replace function public.admin_list_blog_author_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', requests.id,
    'userId', requests.user_id,
    'email', users.email,
    'displayName', coalesce(
      nullif(btrim(tipsters.display_name), ''),
      nullif(btrim(profiles.display_name), ''),
      nullif(split_part(users.email, '@', 1), ''),
      'MRC Author'
    ),
    'status', requests.status,
    'requestReason', requests.request_reason,
    'reviewNote', requests.review_note,
    'requestedAt', requests.created_at,
    'reviewedAt', requests.reviewed_at,
    'tipsterId', tipsters.id,
    'canPublish', coalesce(permissions.can_publish, false),
    'isTipster', coalesce(tipsters.is_verified, false),
    'isPublic', coalesce(tipsters.is_public, false)
  ) order by
    case requests.status when 'requested' then 0 else 1 end,
    requests.updated_at desc), '[]'::jsonb)
  into result
  from public.blog_author_requests requests
  join auth.users users on users.id = requests.user_id
  left join public.profiles profiles on profiles.id = users.id
  left join public.tipsters tipsters on tipsters.user_id = users.id
  left join public.tipster_blog_permissions permissions
    on permissions.tipster_id = tipsters.id;

  return result;
end;
$$;

create or replace function public.admin_review_blog_author_request(
  p_request_id uuid,
  p_action text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_row public.blog_author_requests%rowtype;
  tipster_id_value uuid;
  next_status text;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 1000 then
    raise exception 'A review note of 5 to 1000 characters is required.';
  end if;

  select * into request_row
  from public.blog_author_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Blog author request not found.';
  end if;

  case lower(btrim(coalesce(p_action, '')))
    when 'approve' then
      if not app_private.account_is_active(request_row.user_id) then
        raise exception 'An active account is required for blog publishing.';
      end if;
      if not exists (
        select 1 from auth.users
        where id = request_row.user_id and email_confirmed_at is not null
      ) then
        raise exception 'Confirm the account email before approving blog publishing.';
      end if;
      tipster_id_value := app_private.ensure_blog_author_profile(request_row.user_id);
      insert into public.tipster_blog_permissions (
        tipster_id, can_publish, granted_by, granted_at, reason
      ) values (
        tipster_id_value, true, actor_id, now(), btrim(p_note)
      )
      on conflict (tipster_id) do update
      set
        can_publish = true,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        reason = excluded.reason;
      next_status := 'approved';
    when 'reject' then
      update public.tipster_blog_permissions permissions
      set can_publish = false, granted_at = null, granted_by = actor_id, reason = btrim(p_note)
      from public.tipsters tipsters
      where tipsters.user_id = request_row.user_id
        and permissions.tipster_id = tipsters.id;
      next_status := 'rejected';
    when 'revoke' then
      update public.tipster_blog_permissions permissions
      set can_publish = false, granted_at = null, granted_by = actor_id, reason = btrim(p_note)
      from public.tipsters tipsters
      where tipsters.user_id = request_row.user_id
        and permissions.tipster_id = tipsters.id;
      next_status := 'revoked';
    else
      raise exception 'Unsupported review action.';
  end case;

  update public.blog_author_requests
  set
    status = next_status,
    reviewed_by = actor_id,
    reviewed_at = now(),
    review_note = btrim(p_note)
  where id = request_row.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'blog_author_request_' || next_status,
    'blog_author_request',
    request_row.id,
    jsonb_build_object(
      'targetUserId', request_row.user_id,
      'previousStatus', request_row.status,
      'nextStatus', next_status,
      'note', btrim(p_note),
      'tipsterId', tipster_id_value
    )
  );

  return jsonb_build_object(
    'requestId', request_row.id,
    'userId', request_row.user_id,
    'status', next_status,
    'tipsterId', tipster_id_value
  );
end;
$$;

create or replace function public.admin_set_tipster_blog_permission(
  p_user_id uuid,
  p_can_publish boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  tipster_id_value uuid;
  permission_row public.tipster_blog_permissions%rowtype;
  request_reason_value text;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'An audit reason of 5 to 500 characters is required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  if p_can_publish then
    if not app_private.account_is_active(p_user_id) then
      raise exception 'An active account is required for blog publishing.';
    end if;
    if not exists (
      select 1 from auth.users
      where id = p_user_id and email_confirmed_at is not null
    ) then
      raise exception 'Confirm the account email before approving blog publishing.';
    end if;
    tipster_id_value := app_private.ensure_blog_author_profile(p_user_id);
  else
    select id into tipster_id_value
    from public.tipsters
    where user_id = p_user_id;
  end if;

  if tipster_id_value is not null then
    insert into public.tipster_blog_permissions (
      tipster_id, can_publish, granted_by, granted_at, reason
    ) values (
      tipster_id_value,
      p_can_publish,
      actor_id,
      case when p_can_publish then now() else null end,
      btrim(p_reason)
    )
    on conflict (tipster_id) do update
    set
      can_publish = excluded.can_publish,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      reason = excluded.reason
    returning * into permission_row;
  end if;

  request_reason_value := case
    when char_length(btrim(p_reason)) >= 10 then btrim(p_reason)
    else 'Admin approval: ' || btrim(p_reason)
  end;

  if p_can_publish then
    insert into public.blog_author_requests (
      user_id, status, request_reason, reviewed_by, reviewed_at, review_note
    ) values (
      p_user_id, 'approved', request_reason_value, actor_id, now(), btrim(p_reason)
    )
    on conflict (user_id) do update
    set
      status = 'approved',
      reviewed_by = actor_id,
      reviewed_at = now(),
      review_note = btrim(p_reason);
  else
    update public.blog_author_requests
    set
      status = 'revoked',
      reviewed_by = actor_id,
      reviewed_at = now(),
      review_note = btrim(p_reason)
    where user_id = p_user_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'blog_author_permission_changed',
    'blog_author',
    p_user_id,
    jsonb_build_object('canPublish', p_can_publish, 'reason', btrim(p_reason))
  );

  return coalesce(to_jsonb(permission_row), jsonb_build_object(
    'tipster_id', tipster_id_value,
    'can_publish', false
  ));
end;
$$;

create or replace function public.admin_configure_user_v3(
  p_user_id uuid,
  p_client boolean,
  p_tipster boolean,
  p_administrator boolean,
  p_tipster_display_name text default null,
  p_tipster_biography text default null,
  p_tipster_public boolean default false,
  p_blog_publish boolean default false,
  p_test_access boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_owner boolean := app_private.current_user_is_owner();
  target_is_owner boolean;
  target_is_administrator boolean;
  previous_blog_publish boolean := false;
  tipster_row public.tipsters%rowtype;
  display_name_value text;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required.';
  end if;

  if p_tipster_public and not p_tipster then
    raise exception 'Only an approved tipster can be shown publicly.';
  end if;

  if (p_tipster or p_blog_publish) and not app_private.account_is_active(p_user_id) then
    raise exception 'An active account is required for Tipster or blog-author access.';
  end if;

  if p_blog_publish and not exists (
    select 1 from auth.users
    where id = p_user_id and email_confirmed_at is not null
  ) then
    raise exception 'Confirm the account email before approving blog publishing.';
  end if;

  target_is_owner := exists (
    select 1 from public.platform_owners where user_id = p_user_id
  );
  target_is_administrator := exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'administrator'
  );

  if target_is_owner and not p_administrator then
    raise exception 'The platform owner cannot be demoted.';
  end if;

  if not actor_is_owner and target_is_administrator then
    raise exception 'Only the platform owner can configure another administrator.';
  end if;

  if p_administrator <> target_is_administrator and not actor_is_owner then
    raise exception 'Only the platform owner can grant or remove administrator access.';
  end if;

  if not p_client and not p_tipster and not p_administrator then
    raise exception 'At least one role is required.';
  end if;

  select coalesce(permissions.can_publish, false)
  into previous_blog_publish
  from public.tipsters tipsters
  left join public.tipster_blog_permissions permissions
    on permissions.tipster_id = tipsters.id
  where tipsters.user_id = p_user_id;

  previous_blog_publish := coalesce(previous_blog_publish, false);

  if p_client then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'client')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'client';
  end if;

  if p_tipster then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'tipster')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'tipster';
  end if;

  if p_administrator then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'administrator')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'administrator';
  end if;

  if p_tipster or p_blog_publish or exists (
    select 1 from public.tipsters where user_id = p_user_id
  ) then
    select coalesce(
      nullif(btrim(coalesce(p_tipster_display_name, '')), ''),
      nullif(btrim(profiles.display_name), ''),
      nullif(split_part(users.email, '@', 1), ''),
      'MRC Author'
    )
    into display_name_value
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    where users.id = p_user_id;

    insert into public.tipsters (
      user_id, display_name, biography, is_verified, is_public
    ) values (
      p_user_id,
      display_name_value,
      nullif(btrim(coalesce(p_tipster_biography, '')), ''),
      p_tipster,
      p_tipster and p_tipster_public
    )
    on conflict (user_id) do update
    set
      display_name = excluded.display_name,
      biography = excluded.biography,
      is_verified = excluded.is_verified,
      is_public = excluded.is_public,
      updated_at = now()
    returning * into tipster_row;
  end if;

  if p_blog_publish then
    perform public.admin_set_tipster_blog_permission(p_user_id, true, p_reason);
  elsif previous_blog_publish then
    perform public.admin_set_tipster_blog_permission(p_user_id, false, p_reason);
  end if;

  if p_test_access then
    insert into public.test_access_users (user_id, granted_by)
    values (p_user_id, actor_id)
    on conflict (user_id) do update
    set granted_by = excluded.granted_by;
  else
    delete from public.test_access_users where user_id = p_user_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'user_access_configured_v3',
    'profile',
    p_user_id,
    jsonb_build_object(
      'client', p_client,
      'tipster', p_tipster,
      'tipsterPublic', p_tipster and p_tipster_public,
      'blogPublish', p_blog_publish,
      'administrator', p_administrator,
      'testAccess', p_test_access,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'client', p_client,
    'tipster', p_tipster,
    'administrator', p_administrator,
    'tipsterId', tipster_row.id,
    'tipsterVerified', coalesce(tipster_row.is_verified, false),
    'tipsterPublic', coalesce(tipster_row.is_public, false),
    'blogPublish', p_blog_publish,
    'testAccess', p_test_access
  );
end;
$$;

create or replace function public.admin_review_tipster_application(
  p_application_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  application_row public.tipster_applications%rowtype;
  next_status text;
  required_document_count integer;
  approved_tipster_id uuid;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A review reason of at least ten characters is required.';
  end if;

  select * into application_row
  from public.tipster_applications
  where id = p_application_id
  for update;

  if application_row.id is null then
    raise exception 'Tipster application not found.';
  end if;

  case lower(btrim(coalesce(p_action, '')))
    when 'start_review' then
      if application_row.status <> 'submitted' then
        raise exception 'Only a submitted application can enter review.';
      end if;
      next_status := 'under_review';
    when 'request_changes' then
      if application_row.status not in ('submitted', 'under_review') then
        raise exception 'This application cannot be returned for changes.';
      end if;
      next_status := 'changes_requested';
    when 'reject' then
      if application_row.status not in ('submitted', 'under_review') then
        raise exception 'This application cannot be rejected.';
      end if;
      next_status := 'rejected';
    when 'approve' then
      if application_row.status not in ('submitted', 'under_review') then
        raise exception 'Only a submitted or reviewed application can be approved.';
      end if;
      if application_row.contract_accepted_at is null
        or application_row.contract_version is null
        or application_row.contract_content_hash is null then
        raise exception 'A signed contract record is required before approval.';
      end if;

      select count(distinct documents.document_type)
      into required_document_count
      from public.tipster_application_documents documents
      where documents.application_id = application_row.id
        and documents.document_type in ('identity', 'proof_of_address');
      if required_document_count <> 2 then
        raise exception 'Identity and proof-of-address documents are required before approval.';
      end if;

      insert into public.user_roles (user_id, role)
      values (application_row.user_id, 'tipster')
      on conflict (user_id, role) do nothing;

      insert into public.tipsters (
        user_id,
        display_name,
        biography,
        is_verified,
        is_public,
        commission_rate_override
      )
      values (
        application_row.user_id,
        application_row.display_name,
        application_row.biography,
        true,
        true,
        application_row.approved_commission_rate
      )
      on conflict (user_id) do update
      set
        display_name = excluded.display_name,
        biography = excluded.biography,
        is_verified = true,
        is_public = true,
        commission_rate_override = excluded.commission_rate_override,
        updated_at = now()
      returning id into approved_tipster_id;
      next_status := 'approved';
    when 'revoke' then
      if application_row.status <> 'approved' then
        raise exception 'Only an approved tipster can be revoked.';
      end if;
      delete from public.user_roles
      where user_id = application_row.user_id and role = 'tipster';
      update public.tipsters
      set is_verified = false, is_public = false, updated_at = now()
      where user_id = application_row.user_id
      returning id into approved_tipster_id;
      next_status := 'revoked';
    else
      raise exception 'Unsupported review action.';
  end case;

  update public.tipster_applications
  set
    status = next_status,
    reviewed_at = now(),
    reviewed_by = actor_id,
    review_reason = btrim(p_reason)
  where id = application_row.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'tipster_application_' || next_status,
    'tipster_application',
    application_row.id,
    jsonb_build_object(
      'targetUserId', application_row.user_id,
      'previousStatus', application_row.status,
      'nextStatus', next_status,
      'reason', btrim(p_reason),
      'tipsterId', approved_tipster_id
    )
  );

  return jsonb_build_object(
    'applicationId', application_row.id,
    'userId', application_row.user_id,
    'status', next_status,
    'tipsterId', approved_tipster_id
  );
end;
$$;

insert into public.blog_author_requests (
  user_id,
  status,
  request_reason,
  reviewed_by,
  reviewed_at,
  review_note
)
select
  tipsters.user_id,
  case when permissions.can_publish then 'approved' else 'revoked' end,
  'Legacy blog author permission migrated to the approval workflow.',
  permissions.granted_by,
  coalesce(permissions.granted_at, permissions.updated_at),
  coalesce(permissions.reason, 'Existing permission migrated by administrator.')
from public.tipster_blog_permissions permissions
join public.tipsters tipsters on tipsters.id = permissions.tipster_id
on conflict (user_id) do nothing;

drop policy if exists tipsters_public_read_verified on public.tipsters;
create policy tipsters_public_read_verified
on public.tipsters for select
to anon, authenticated
using (is_verified = true and is_public = true);

drop policy if exists tipster_packages_public_read on public.tipster_packages;
create policy tipster_packages_public_read
on public.tipster_packages for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.tipsters tipsters
    where tipsters.id = tipster_packages.tipster_id
      and tipsters.is_verified = true
      and tipsters.is_public = true
  )
);

drop policy if exists tip_cards_marketplace_read on public.tip_cards;
create policy tip_cards_marketplace_read
on public.tip_cards for select
to anon, authenticated
using (
  status in ('coming_soon', 'published')
  and app_private.can_view_meeting(meeting_id)
  and exists (
    select 1
    from public.tipsters tipsters
    where tipsters.id = tip_cards.tipster_id
      and tipsters.is_verified = true
      and tipsters.is_public = true
  )
);

drop policy if exists tip_cards_entitled_read on public.tip_cards;
create policy tip_cards_entitled_read
on public.tip_cards for select
to authenticated
using (
  exists (
    select 1
    from public.tip_card_entitlements entitlements
    where entitlements.tip_card_id = tip_cards.id
      and entitlements.user_id = (select auth.uid())
      and entitlements.revoked_at is null
  )
);

drop policy if exists tipster_packages_subscriber_read on public.tipster_packages;
create policy tipster_packages_subscriber_read
on public.tipster_packages for select
to authenticated
using (
  exists (
    select 1
    from public.tipster_subscriptions subscriptions
    where subscriptions.package_id = tipster_packages.id
      and subscriptions.user_id = (select auth.uid())
  )
);

create or replace function public.get_public_build_manifest()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'blogPosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', posts.slug,
        'lastModified', posts.updated_at
      ) order by posts.updated_at desc)
      from public.blog_posts posts
      where posts.status = 'published' and posts.slug is not null
    ), '[]'::jsonb),
    'tipsters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', tipsters.slug,
        'lastModified', greatest(tipsters.updated_at, coalesce(stats.updated_at, tipsters.updated_at))
      ) order by tipsters.ranking nulls last, tipsters.display_name)
      from public.tipsters tipsters
      left join public.tipster_performance_stats stats on stats.tipster_id = tipsters.id
      where tipsters.is_verified and tipsters.is_public
    ), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'venueSlug', meetings.venue_slug,
        'meetingDate', meetings.meeting_date,
        'lastModified', greatest(meetings.updated_at, coalesce(meetings.source_updated_at, meetings.updated_at))
      ) order by meetings.meeting_date desc, meetings.venue)
      from public.race_meetings meetings
      where not meetings.is_test
        and meetings.meeting_date between current_date - 365 and current_date + 90
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_public_tipster_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', tipsters.id,
    'slug', tipsters.slug,
    'displayName', tipsters.display_name,
    'biography', tipsters.biography,
    'photoPath', tipsters.photo_path,
    'ranking', tipsters.ranking,
    'winnerStrikeRate', stats.winner_strike_rate,
    'settledWinnerTips', coalesce(stats.settled_winner_tips, 0),
    'winnerHits', coalesce(stats.winner_hits, 0),
    'placeStrikeRate', stats.place_strike_rate,
    'settledPlaceTips', coalesce(stats.settled_place_tips, 0),
    'placeHits', coalesce(stats.place_hits, 0),
    'statsUpdatedAt', stats.updated_at,
    'updatedAt', tipsters.updated_at
  )
  from public.tipsters tipsters
  left join public.tipster_performance_stats stats
    on stats.tipster_id = tipsters.id
  where tipsters.is_verified
    and tipsters.is_public
    and tipsters.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function public.get_public_blog_article(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', posts.id,
    'slug', posts.slug,
    'title', posts.title,
    'excerpt', posts.excerpt,
    'bodyMarkdown', posts.body_markdown,
    'coverImagePath', posts.cover_image_path,
    'videoUrl', posts.video_url,
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'authorSlug', case
      when tipsters.is_verified and tipsters.is_public then tipsters.slug
      else null
    end,
    'authorPhotoPath', tipsters.photo_path
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.status = 'published'
    and posts.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function app_private.enforce_meeting_purchase_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
begin
  if new.purchase_type <> 'meeting' then
    return new;
  end if;

  select
    cards.tipster_id,
    cards.status,
    cards.published_at,
    meetings.first_race_at,
    tipsters.is_verified and tipsters.is_public as seller_available
  into card_row
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  join public.tipsters tipsters on tipsters.id = cards.tipster_id
  where cards.id = new.tip_card_id;

  if card_row.tipster_id is null
    or card_row.status <> 'published'
    or card_row.published_at is null
    or not coalesce(card_row.seller_available, false)
  then
    raise exception 'This meeting card is unavailable.';
  end if;

  if new.tipster_id <> card_row.tipster_id then
    raise exception 'The meeting-card seller does not match the published card.';
  end if;

  if exists (
    select 1
    from public.tipster_subscriptions subscriptions
    join public.content_purchases subscription_purchases
      on subscription_purchases.id = subscriptions.purchase_id
     and subscription_purchases.purchase_type = 'subscription'
     and subscription_purchases.status = 'active'
     and subscription_purchases.refunded_at is null
    where subscriptions.user_id = new.user_id
      and subscriptions.tipster_id = card_row.tipster_id
      and subscriptions.status = 'active'
      and card_row.first_race_at >= subscriptions.starts_at
      and card_row.first_race_at < subscriptions.ends_at
  ) then
    raise exception 'This meeting card is already included in your active subscription.';
  end if;

  return new;
end;
$$;

create or replace function public.purchase_meeting_card(
  p_tip_card_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_meeting_card_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  existing_purchase_id uuid;
  card_row record;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this meeting-card purchase before Credits are deducted.';
  end if;

  select
    cards.tipster_id,
    cards.status,
    cards.published_at,
    meetings.first_race_at
  into card_row
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  join public.tipsters tipsters
    on tipsters.id = cards.tipster_id
   and tipsters.is_verified = true
   and tipsters.is_public = true
  where cards.id = p_tip_card_id;

  if card_row.tipster_id is null
    or card_row.status <> 'published'
    or card_row.published_at is null
  then
    raise exception 'This meeting card is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meeting-purchase:' || current_user_id::text || ':' || p_tip_card_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.tipster_subscriptions subscriptions
    join public.content_purchases subscription_purchases
      on subscription_purchases.id = subscriptions.purchase_id
     and subscription_purchases.purchase_type = 'subscription'
     and subscription_purchases.status = 'active'
     and subscription_purchases.refunded_at is null
    where subscriptions.user_id = current_user_id
      and subscriptions.tipster_id = card_row.tipster_id
      and subscriptions.status = 'active'
      and card_row.first_race_at >= subscriptions.starts_at
      and card_row.first_race_at < subscriptions.ends_at
  ) then
    raise exception 'This meeting card is already included in your active subscription.';
  end if;

  if exists (
    select 1
    from public.content_purchases purchases
    where purchases.user_id = current_user_id
      and purchases.tip_card_id = p_tip_card_id
      and purchases.status in ('active', 'disputed')
  ) then
    raise exception 'You already own this meeting card and cannot purchase it twice.';
  end if;

  return public.purchase_meeting_card(p_tip_card_id, p_idempotency_key);
end;
$purchase_meeting_card_confirmed$;

create or replace function public.purchase_tipster_subscription(
  p_package_id uuid,
  p_idempotency_key text,
  p_purchase_confirmed boolean,
  p_confirm_extension boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $purchase_tipster_subscription_confirmed$
declare
  current_user_id uuid := (select auth.uid());
  package_tipster_id uuid;
  existing_purchase_id uuid;
  active_until timestamptz;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select purchases.id into existing_purchase_id
  from public.content_purchases purchases
  where purchases.user_id = current_user_id
    and purchases.idempotency_key = p_idempotency_key;

  if existing_purchase_id is not null then
    return public.purchase_tipster_subscription(p_package_id, p_idempotency_key);
  end if;

  if not coalesce(p_purchase_confirmed, false) then
    raise exception 'Confirm this subscription purchase before Credits are deducted.';
  end if;

  select packages.tipster_id into package_tipster_id
  from public.tipster_packages packages
  join public.tipsters tipsters
    on tipsters.id = packages.tipster_id
   and tipsters.is_verified = true
   and tipsters.is_public = true
  where packages.id = p_package_id
    and packages.is_active = true;

  if package_tipster_id is null then
    raise exception 'This subscription package is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'subscription-purchase:' || current_user_id::text || ':' || package_tipster_id::text,
      0
    )
  );

  select max(subscriptions.ends_at) into active_until
  from public.tipster_subscriptions subscriptions
  where subscriptions.user_id = current_user_id
    and subscriptions.tipster_id = package_tipster_id
    and subscriptions.status = 'active'
    and subscriptions.ends_at > now();

  if active_until is not null and not coalesce(p_confirm_extension, false) then
    raise exception 'You already have an active subscription. Confirm that you want to extend it.';
  end if;

  result := public.purchase_tipster_subscription(p_package_id, p_idempotency_key);

  return result || jsonb_build_object(
    'extendedExistingSubscription', active_until is not null,
    'previousEndsAt', active_until
  );
end;
$purchase_tipster_subscription_confirmed$;

revoke all on function app_private.ensure_blog_author_profile(uuid)
from public, anon, authenticated;
revoke all on function app_private.current_blog_tipster_id()
from public, anon, authenticated;
revoke all on function app_private.current_tipster_can_publish_blog()
from public, anon, authenticated;
revoke all on function app_private.enforce_meeting_purchase_eligibility()
from public, anon, authenticated;

revoke all on function public.get_my_blog_author_access()
from public, anon, authenticated;
grant execute on function public.get_my_blog_author_access() to authenticated;

revoke all on function public.request_blog_author_access(text)
from public, anon, authenticated;
grant execute on function public.request_blog_author_access(text) to authenticated;

revoke all on function public.admin_list_blog_author_requests()
from public, anon, authenticated;
grant execute on function public.admin_list_blog_author_requests() to authenticated;

revoke all on function public.admin_review_blog_author_request(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_review_blog_author_request(uuid, text, text)
to authenticated;

revoke all on function public.admin_set_tipster_blog_permission(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.admin_set_tipster_blog_permission(uuid, boolean, text)
to authenticated;

revoke all on function public.admin_configure_user_v3(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean, boolean, text
)
from public, anon, authenticated;
grant execute on function public.admin_configure_user_v3(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean, boolean, text
)
to authenticated;

revoke all on function public.admin_review_tipster_application(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_review_tipster_application(uuid, text, text)
to authenticated;

revoke all on function public.get_public_build_manifest() from public;
grant execute on function public.get_public_build_manifest() to anon, authenticated;
revoke all on function public.get_public_tipster_profile(text) from public;
grant execute on function public.get_public_tipster_profile(text) to anon, authenticated;
revoke all on function public.get_public_blog_article(text) from public;
grant execute on function public.get_public_blog_article(text) to anon, authenticated;
revoke all on function public.purchase_meeting_card(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.purchase_meeting_card(uuid, text, boolean)
to authenticated;
revoke all on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.purchase_tipster_subscription(uuid, text, boolean, boolean)
to authenticated;

select app_private.queue_site_content_build(
  'Independent blog-author approval and Tipster visibility enabled',
  'migration',
  null
);
