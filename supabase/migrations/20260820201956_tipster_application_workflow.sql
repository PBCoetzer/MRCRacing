-- Unified tipster application, private supporting documents, contract acceptance,
-- and approval. The internal role and verification flag remain separate controls,
-- but may only be granted together by the reviewed application workflow.

create table if not exists public.tipster_contract_versions (
  version text primary key,
  title text not null,
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  content_hash text not null unique check (content_hash ~ '^[a-f0-9]{64}$'),
  default_commission_rate numeric(5, 2) not null check (default_commission_rate between 0 and 100),
  horse_care_share_bps integer not null check (horse_care_share_bps between 0 and 10000),
  effective_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists tipster_contract_versions_one_active_idx
on public.tipster_contract_versions (is_active)
where is_active;

create table if not exists public.tipster_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'revoked', 'withdrawn')
  ),
  legal_name text,
  display_name text,
  phone text,
  experience_summary text,
  biography text,
  contract_version text references public.tipster_contract_versions(version),
  contract_content_hash text,
  signature_name text,
  acceptance_confirmations jsonb,
  contract_accepted_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_reason text,
  approved_commission_rate numeric(5, 2) check (approved_commission_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tipster_applications_status_created_idx
on public.tipster_applications (status, created_at desc);

create table if not exists public.tipster_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.tipster_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (
    document_type in ('identity', 'proof_of_address', 'tax', 'bank_confirmation', 'other')
  ),
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (application_id, document_type)
);

drop trigger if exists tipster_applications_set_updated_at on public.tipster_applications;
create trigger tipster_applications_set_updated_at
before update on public.tipster_applications
for each row execute function public.set_updated_at();

with contract_sections as (
  select jsonb_build_array(
    jsonb_build_object(
      'heading', '1. Appointment and eligibility',
      'body', 'The applicant asks MRC Racing Tips to approve them as an independent tipster. Approval is discretionary and depends on identity checks, supporting documents, account standing, racing knowledge, and acceptance of this agreement. The tipster must be at least 18 years old and may not present MRC as a bookmaker, employer, partner, or gambling operator.'
    ),
    jsonb_build_object(
      'heading', '2. Tip content and responsible conduct',
      'body', 'The tipster must publish honest, original horse-racing analysis, keep selections and corrections accurate, disclose material conflicts, and never promise guaranteed returns. Content must comply with MRC policies, responsible-gambling requirements, applicable law, and race-card cut-off rules. Fabricated records, misleading strike rates, copied premium content, or prohibited bookmaker data may result in suspension or termination.'
    ),
    jsonb_build_object(
      'heading', '3. Platform commission',
      'body', 'The standard MRC platform commission for this agreement is 10% of Purchased Credits actually used for an eligible meeting card or subscription. The remaining qualifying amount is recorded as the tipster net earning. Any individual commission override or future rate change must be recorded by MRC and communicated as a written amendment or replacement contract version before it applies.'
    ),
    jsonb_build_object(
      'heading', '4. Purchased Credits and Reward Credits',
      'body', 'Purchased Credits originate from completed customer payments. Reward Credits are promotional, remain separate, and are used before Purchased Credits where the platform rules require it. Reward Credits grant access but do not create a tipster earning, MRC platform commission, cash entitlement, or horse-care contribution. For mixed payments, earnings and commission are calculated only from the Purchased Credit portion.'
    ),
    jsonb_build_object(
      'heading', '5. Horse-care contribution',
      'body', 'MRC records a contribution equal to 10% of its qualifying platform commission for the nominated horse-care initiative. This is funded from MRC''s commission and is not an additional deduction from the tipster net earning. Refunds reverse the related earning, commission, and contribution entries. Reward-only access creates no contribution.'
    ),
    jsonb_build_object(
      'heading', '6. Prices, purchases, refunds, and records',
      'body', 'The tipster may propose meeting-card and subscription prices within MRC limits. MRC records entitlements, qualifying earnings, reversals, and settlement history. A customer refund, void meeting, duplicate charge, fraud event, or approved dispute may reverse an earning. Platform records are the operational source of truth, subject to correction through the audited dispute process.'
    ),
    jsonb_build_object(
      'heading', '7. Intellectual property and licence',
      'body', 'The tipster retains ownership of original material but grants MRC a non-exclusive licence to host, format, market, archive, moderate, and display it for operating and promoting the platform. The tipster warrants that submitted text, images, video, and documents do not infringe another person''s rights.'
    ),
    jsonb_build_object(
      'heading', '8. Confidentiality, privacy, and documents',
      'body', 'Application documents and personal information are provided for identity, compliance, contracting, support, and payment-readiness checks. MRC must protect them under its privacy and security controls and restrict access to authorised administrators. The applicant must keep customer information, private platform information, access codes, and security details confidential.'
    ),
    jsonb_build_object(
      'heading', '9. Monitoring, suspension, and termination',
      'body', 'MRC may review content and audit account activity. MRC may request corrections, suspend publication, revoke approval, withhold disputed settlement, or terminate access for breach, fraud, abuse, security risk, legal risk, or reputational harm. Existing customer entitlements, refunds, audit records, and lawful retention duties survive termination where applicable.'
    ),
    jsonb_build_object(
      'heading', '10. Electronic acceptance and changes',
      'body', 'Typing the applicant''s legal name and submitting the application records electronic acceptance of this exact contract version and content hash. MRC may issue a new version for future changes; material changes require fresh acceptance before continued tipster activity where required. This agreement operates with the website Terms, Privacy Policy, Refund Policy, and Cancellation Policy.'
    )
  ) as sections
)
insert into public.tipster_contract_versions (
  version,
  title,
  sections,
  content_hash,
  default_commission_rate,
  horse_care_share_bps,
  effective_at,
  is_active
)
select
  '2026-08-20-v1',
  'MRC Tipster Platform Agreement',
  sections,
  encode(extensions.digest(convert_to(sections::text, 'UTF8'), 'sha256'), 'hex'),
  10.00,
  1000,
  timestamptz '2026-08-20 00:00:00+02',
  true
from contract_sections
on conflict (version) do nothing;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tipster-applications',
  'tipster-applications',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.tipster_contract_versions enable row level security;
alter table public.tipster_applications enable row level security;
alter table public.tipster_application_documents enable row level security;

drop policy if exists tipster_contract_versions_authenticated_read on public.tipster_contract_versions;
create policy tipster_contract_versions_authenticated_read
on public.tipster_contract_versions
for select
to authenticated
using (true);

drop policy if exists tipster_applications_own_read on public.tipster_applications;
create policy tipster_applications_own_read
on public.tipster_applications
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists tipster_applications_admin_read on public.tipster_applications;
create policy tipster_applications_admin_read
on public.tipster_applications
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists tipster_application_documents_own_read on public.tipster_application_documents;
create policy tipster_application_documents_own_read
on public.tipster_application_documents
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists tipster_application_documents_admin_read on public.tipster_application_documents;
create policy tipster_application_documents_admin_read
on public.tipster_application_documents
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists tipster_application_documents_own_insert on public.tipster_application_documents;
create policy tipster_application_documents_own_insert
on public.tipster_application_documents
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and split_part(storage_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1
    from public.tipster_applications applications
    where applications.id = application_id
      and applications.user_id = (select auth.uid())
      and applications.status in ('draft', 'changes_requested', 'rejected')
  )
);

drop policy if exists tipster_application_documents_own_delete on public.tipster_application_documents;
create policy tipster_application_documents_own_delete
on public.tipster_application_documents
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.tipster_applications applications
    where applications.id = application_id
      and applications.user_id = (select auth.uid())
      and applications.status in ('draft', 'changes_requested', 'rejected')
  )
);

drop policy if exists tipster_application_storage_own_read on storage.objects;
create policy tipster_application_storage_own_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'tipster-applications'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists tipster_application_storage_admin_read on storage.objects;
create policy tipster_application_storage_admin_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'tipster-applications'
  and app_private.current_user_has_role('administrator')
);

drop policy if exists tipster_application_storage_own_insert on storage.objects;
create policy tipster_application_storage_own_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'tipster-applications'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.tipster_applications applications
    where applications.id::text = (storage.foldername(name))[2]
      and applications.user_id = (select auth.uid())
      and applications.status in ('draft', 'changes_requested', 'rejected')
  )
);

drop policy if exists tipster_application_storage_own_delete on storage.objects;
create policy tipster_application_storage_own_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'tipster-applications'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.tipster_applications applications
    where applications.id::text = (storage.foldername(name))[2]
      and applications.user_id = (select auth.uid())
      and applications.status in ('draft', 'changes_requested', 'rejected')
  )
);

create or replace function public.ensure_my_tipster_application()
returns public.tipster_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  application_row public.tipster_applications%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.tipster_applications (user_id)
  values (actor_id)
  on conflict (user_id) do nothing;

  select *
  into application_row
  from public.tipster_applications
  where user_id = actor_id;

  return application_row;
end;
$$;

create or replace function public.save_my_tipster_application(
  p_legal_name text,
  p_display_name text,
  p_phone text,
  p_experience_summary text,
  p_biography text
)
returns public.tipster_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  application_row public.tipster_applications%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into application_row
  from public.tipster_applications
  where user_id = actor_id
  for update;

  if application_row.id is null then
    raise exception 'Application not found. Reload the page and try again.';
  end if;

  if application_row.status not in ('draft', 'changes_requested', 'rejected') then
    raise exception 'This application cannot be edited in its current state.';
  end if;

  if char_length(btrim(coalesce(p_legal_name, ''))) not between 3 and 160 then
    raise exception 'Legal name must be between 3 and 160 characters.';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 80 then
    raise exception 'Tipster display name must be between 2 and 80 characters.';
  end if;
  if char_length(btrim(coalesce(p_phone, ''))) not between 7 and 30 then
    raise exception 'A valid contact number is required.';
  end if;
  if char_length(btrim(coalesce(p_experience_summary, ''))) not between 80 and 3000 then
    raise exception 'Racing experience summary must be between 80 and 3000 characters.';
  end if;
  if char_length(btrim(coalesce(p_biography, ''))) not between 40 and 1500 then
    raise exception 'Public biography must be between 40 and 1500 characters.';
  end if;

  update public.tipster_applications
  set
    status = 'draft',
    legal_name = btrim(p_legal_name),
    display_name = btrim(p_display_name),
    phone = btrim(p_phone),
    experience_summary = btrim(p_experience_summary),
    biography = btrim(p_biography),
    review_reason = case when status in ('changes_requested', 'rejected') then review_reason else null end
  where id = application_row.id
  returning * into application_row;

  return application_row;
end;
$$;

create or replace function public.submit_my_tipster_application(
  p_legal_name text,
  p_display_name text,
  p_phone text,
  p_experience_summary text,
  p_biography text,
  p_contract_version text,
  p_contract_content_hash text,
  p_signature_name text,
  p_confirm_age boolean,
  p_confirm_accurate boolean,
  p_accept_agreement boolean
)
returns public.tipster_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  application_row public.tipster_applications%rowtype;
  contract_row public.tipster_contract_versions%rowtype;
  required_document_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from auth.users users
    where users.id = actor_id and users.email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email address before submitting a tipster application.';
  end if;

  select * into application_row
  from public.tipster_applications
  where user_id = actor_id
  for update;

  if application_row.id is null or application_row.status not in ('draft', 'changes_requested', 'rejected') then
    raise exception 'This application cannot be submitted in its current state.';
  end if;

  if char_length(btrim(coalesce(p_legal_name, ''))) not between 3 and 160
    or char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 80
    or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 30
    or char_length(btrim(coalesce(p_experience_summary, ''))) not between 80 and 3000
    or char_length(btrim(coalesce(p_biography, ''))) not between 40 and 1500 then
    raise exception 'Complete every application field before submitting.';
  end if;

  select * into contract_row
  from public.tipster_contract_versions
  where version = p_contract_version
    and content_hash = lower(btrim(coalesce(p_contract_content_hash, '')))
    and is_active;

  if contract_row.version is null then
    raise exception 'The agreement has changed. Reload and review the current version.';
  end if;

  if not coalesce(p_confirm_age, false)
    or not coalesce(p_confirm_accurate, false)
    or not coalesce(p_accept_agreement, false) then
    raise exception 'All declarations and the agreement must be accepted.';
  end if;

  if lower(btrim(coalesce(p_signature_name, ''))) <> lower(btrim(p_legal_name)) then
    raise exception 'The electronic signature must match the legal name.';
  end if;

  select count(distinct documents.document_type)
  into required_document_count
  from public.tipster_application_documents documents
  where documents.application_id = application_row.id
    and documents.user_id = actor_id
    and documents.document_type in ('identity', 'proof_of_address');

  if required_document_count <> 2 then
    raise exception 'Identity and proof-of-address documents are required.';
  end if;

  update public.tipster_applications
  set
    status = 'submitted',
    legal_name = btrim(p_legal_name),
    display_name = btrim(p_display_name),
    phone = btrim(p_phone),
    experience_summary = btrim(p_experience_summary),
    biography = btrim(p_biography),
    contract_version = contract_row.version,
    contract_content_hash = contract_row.content_hash,
    signature_name = btrim(p_signature_name),
    acceptance_confirmations = jsonb_build_object(
      'over18', true,
      'informationAccurate', true,
      'agreementAccepted', true
    ),
    contract_accepted_at = now(),
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    review_reason = null,
    approved_commission_rate = contract_row.default_commission_rate
  where id = application_row.id
  returning * into application_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'tipster_application_submitted',
    'tipster_application',
    application_row.id,
    jsonb_build_object(
      'contractVersion', contract_row.version,
      'contractContentHash', contract_row.content_hash,
      'commissionRate', contract_row.default_commission_rate
    )
  );

  return application_row;
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
        commission_rate_override
      )
      values (
        application_row.user_id,
        application_row.display_name,
        application_row.biography,
        true,
        application_row.approved_commission_rate
      )
      on conflict (user_id) do update
      set
        display_name = excluded.display_name,
        biography = excluded.biography,
        is_verified = true,
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
      set is_verified = false, updated_at = now()
      where user_id = application_row.user_id
      returning id into approved_tipster_id;
      update public.tipster_blog_permissions
      set can_publish = false, updated_at = now()
      where tipster_blog_permissions.tipster_id = approved_tipster_id;
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

-- Preserve existing approved tipsters and correct any legacy half-approved state.
insert into public.user_roles (user_id, role)
select tipsters.user_id, 'tipster'::public.app_role
from public.tipsters tipsters
where tipsters.is_verified
on conflict (user_id, role) do nothing;

insert into public.tipster_applications (
  user_id,
  status,
  legal_name,
  display_name,
  biography,
  reviewed_at,
  review_reason,
  approved_commission_rate
)
select
  tipsters.user_id,
  'approved',
  coalesce(nullif(btrim(profiles.display_name), ''), tipsters.display_name),
  tipsters.display_name,
  tipsters.biography,
  now(),
  'Legacy approved tipster migrated into the unified application workflow.',
  coalesce(
    tipsters.commission_rate_override,
    (select settings.commission_rate from public.platform_settings settings where settings.singleton)
  )
from public.tipsters tipsters
left join public.profiles profiles on profiles.id = tipsters.user_id
where tipsters.is_verified
on conflict (user_id) do nothing;

revoke all on table public.tipster_contract_versions from anon, authenticated;
revoke all on table public.tipster_applications from anon, authenticated;
revoke all on table public.tipster_application_documents from anon, authenticated;

grant select on table public.tipster_contract_versions to authenticated;
grant select on table public.tipster_applications to authenticated;
grant select, insert, delete on table public.tipster_application_documents to authenticated;

revoke all on function public.ensure_my_tipster_application() from public, anon;
revoke all on function public.save_my_tipster_application(text, text, text, text, text) from public, anon;
revoke all on function public.submit_my_tipster_application(text, text, text, text, text, text, text, text, boolean, boolean, boolean) from public, anon;
revoke all on function public.admin_review_tipster_application(uuid, text, text) from public, anon;

grant execute on function public.ensure_my_tipster_application() to authenticated;
grant execute on function public.save_my_tipster_application(text, text, text, text, text) to authenticated;
grant execute on function public.submit_my_tipster_application(text, text, text, text, text, text, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_review_tipster_application(uuid, text, text) to authenticated;
