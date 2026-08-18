-- MRC race lifecycle, settled-card outcomes, ECHCU contribution ledger, and blog.

create extension if not exists unaccent with schema extensions;

create table if not exists public.tip_card_race_outcomes (
  id uuid primary key default gen_random_uuid(),
  tip_card_id uuid not null references public.tip_cards(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  selected_winner_entry_id uuid references public.race_entries(id) on delete set null,
  selected_winner_position integer check (selected_winner_position is null or selected_winner_position > 0),
  winner_hit boolean,
  selected_place_entry_id uuid references public.race_entries(id) on delete set null,
  selected_place_position integer check (selected_place_position is null or selected_place_position > 0),
  official_winner_entry_id uuid references public.race_entries(id) on delete set null,
  result_summary text,
  evidence_hash text not null,
  settled_at timestamptz not null default now(),
  unique (tip_card_id, fixture_id)
);

create table if not exists public.charity_contribution_entries (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.content_purchases(id),
  entry_type text not null check (entry_type in ('accrual', 'reversal', 'adjustment')),
  basis_platform_fee_coins numeric(12, 2) not null,
  zar_per_coin numeric(12, 4) not null check (zar_per_coin > 0),
  contribution_rate_bps integer not null default 1000 check (contribution_rate_bps between 0 and 10000),
  amount_cents integer not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (purchase_id, entry_type)
);

create table if not exists public.charity_remittances (
  id uuid primary key default gen_random_uuid(),
  amount_cents integer not null check (amount_cents > 0),
  transferred_on date not null,
  reference text not null check (char_length(btrim(reference)) between 3 and 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  proof_path text check (proof_path is null or char_length(proof_path) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tipster_blog_permissions (
  tipster_id uuid primary key references public.tipsters(id) on delete cascade,
  can_publish boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz,
  reason text check (reason is null or char_length(btrim(reason)) between 5 and 500),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  tipster_id uuid not null references public.tipsters(id) on delete cascade,
  slug text unique,
  title text not null check (char_length(btrim(title)) between 5 and 160),
  excerpt text not null check (char_length(btrim(excerpt)) between 10 and 400),
  body_markdown text not null check (char_length(btrim(body_markdown)) between 20 and 30000),
  cover_image_path text check (cover_image_path is null or char_length(cover_image_path) <= 500),
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'archived')),
  published_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null,
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1500),
  body_hash text not null,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'withdrawn')),
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null,
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.blog_comments(id) on delete cascade,
  reported_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (comment_id, reported_by)
);

create index if not exists tip_card_race_outcomes_card_idx
on public.tip_card_race_outcomes (tip_card_id, settled_at desc);

create index if not exists charity_contribution_entries_created_idx
on public.charity_contribution_entries (created_at desc);

create index if not exists charity_remittances_date_idx
on public.charity_remittances (transferred_on desc, created_at desc);

create index if not exists blog_posts_public_idx
on public.blog_posts (published_at desc)
where status = 'published';

create index if not exists blog_posts_tipster_idx
on public.blog_posts (tipster_id, updated_at desc);

create index if not exists blog_comments_post_idx
on public.blog_comments (post_id, created_at);

create index if not exists blog_comments_user_rate_idx
on public.blog_comments (user_id, created_at desc);

create index if not exists blog_comment_reports_status_idx
on public.blog_comment_reports (status, created_at desc);

drop trigger if exists set_tipster_blog_permissions_updated_at on public.tipster_blog_permissions;
create trigger set_tipster_blog_permissions_updated_at
before update on public.tipster_blog_permissions
for each row execute function public.set_updated_at();

drop trigger if exists set_blog_posts_updated_at on public.blog_posts;
create trigger set_blog_posts_updated_at
before update on public.blog_posts
for each row execute function public.set_updated_at();

drop trigger if exists set_blog_comments_updated_at on public.blog_comments;
create trigger set_blog_comments_updated_at
before update on public.blog_comments
for each row execute function public.set_updated_at();

create or replace function app_private.reject_immutable_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This audit record is immutable.';
end;
$$;

drop trigger if exists protect_tip_card_race_outcomes on public.tip_card_race_outcomes;
create trigger protect_tip_card_race_outcomes
before update or delete on public.tip_card_race_outcomes
for each row execute function app_private.reject_immutable_record_change();

drop trigger if exists protect_charity_contribution_entries on public.charity_contribution_entries;
create trigger protect_charity_contribution_entries
before update or delete on public.charity_contribution_entries
for each row execute function app_private.reject_immutable_record_change();

create or replace function app_private.user_can_access_tip_card(
  target_tip_card_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.account_is_active(target_user_id)
    and exists (
      select 1
      from public.tip_card_entitlements entitlements
      join public.tip_cards cards on cards.id = entitlements.tip_card_id
      where entitlements.tip_card_id = target_tip_card_id
        and entitlements.user_id = target_user_id
        and entitlements.revoked_at is null
        and cards.status in ('published', 'settled')
    );
$$;

create or replace function app_private.enforce_tip_card_meeting_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meeting_row public.race_meetings%rowtype;
begin
  select * into meeting_row
  from public.race_meetings
  where id = new.meeting_id;

  if meeting_row.id is null then
    raise exception 'The selected meeting is unavailable.';
  end if;

  if tg_op = 'INSERT'
    and (meeting_row.status <> 'scheduled' or meeting_row.first_race_at <= now())
  then
    raise exception 'Meeting cards can only be created before Race 1.';
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('draft', 'coming_soon')
    and new.status <> 'void'
    and (meeting_row.status <> 'scheduled' or meeting_row.first_race_at <= now())
  then
    raise exception 'This meeting card is closed because Race 1 has started.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_tip_card_meeting_window on public.tip_cards;
create trigger enforce_tip_card_meeting_window
before insert or update on public.tip_cards
for each row execute function app_private.enforce_tip_card_meeting_window();

create or replace function app_private.enforce_meeting_purchase_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_type = 'meeting'
    and not exists (
      select 1
      from public.tip_cards cards
      join public.race_meetings meetings on meetings.id = cards.meeting_id
      where cards.id = new.tip_card_id
        and cards.status in ('coming_soon', 'published')
        and meetings.status = 'scheduled'
        and meetings.first_race_at > now()
    )
  then
    raise exception 'This meeting card is no longer available for purchase.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_meeting_purchase_cutoff on public.content_purchases;
create trigger enforce_meeting_purchase_cutoff
before insert on public.content_purchases
for each row execute function app_private.enforce_meeting_purchase_cutoff();

create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  coin_rate numeric(12, 4);
  contribution_cents integer;
begin
  select zar_per_coin into coin_rate
  from public.platform_settings
  where singleton = true;

  coin_rate := coalesce(coin_rate, 1.0000);
  contribution_cents := round(new.platform_fee_coins * coin_rate * 100 * 1000 / 10000.0)::integer;

  if tg_op = 'INSERT' and new.status <> 'refunded' then
    insert into public.charity_contribution_entries (
      purchase_id,
      entry_type,
      basis_platform_fee_coins,
      zar_per_coin,
      contribution_rate_bps,
      amount_cents,
      reason
    ) values (
      new.id,
      'accrual',
      new.platform_fee_coins,
      coin_rate,
      1000,
      contribution_cents,
      '10% of MRC platform commission'
    ) on conflict (purchase_id, entry_type) do nothing;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'refunded'
  then
    insert into public.charity_contribution_entries (
      purchase_id,
      entry_type,
      basis_platform_fee_coins,
      zar_per_coin,
      contribution_rate_bps,
      amount_cents,
      reason
    ) values (
      new.id,
      'reversal',
      -new.platform_fee_coins,
      coin_rate,
      1000,
      -contribution_cents,
      'Contribution reversal for refunded purchase'
    ) on conflict (purchase_id, entry_type) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists record_charity_contribution on public.content_purchases;
create trigger record_charity_contribution
after insert or update of status on public.content_purchases
for each row execute function app_private.record_charity_contribution();

create or replace function public.get_charity_transparency()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with contribution as (
    select coalesce(sum(amount_cents), 0)::integer as accrued_cents
    from public.charity_contribution_entries
  ), remittance as (
    select
      coalesce(sum(amount_cents), 0)::integer as transferred_cents,
      max(transferred_on) as last_transferred_on
    from public.charity_remittances
  )
  select jsonb_build_object(
    'accruedCents', contribution.accrued_cents,
    'transferredCents', remittance.transferred_cents,
    'outstandingCents', greatest(contribution.accrued_cents - remittance.transferred_cents, 0),
    'lastTransferredOn', remittance.last_transferred_on,
    'contributionRatePercent', 10,
    'basis', 'MRC platform commission on content purchases',
    'updatedAt', now()
  )
  from contribution cross join remittance;
$$;

create or replace function public.admin_record_charity_remittance(
  p_amount_cents integer,
  p_transferred_on date,
  p_reference text,
  p_notes text default null,
  p_proof_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  outstanding_cents integer;
  remittance_row public.charity_remittances%rowtype;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A positive remittance amount is required.';
  end if;
  if p_transferred_on is null or p_transferred_on > (now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'Choose a valid transfer date.';
  end if;
  if char_length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'A transfer reference is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('mrc-charity-remittance'));

  select greatest(
    coalesce((select sum(amount_cents) from public.charity_contribution_entries), 0)
      - coalesce((select sum(amount_cents) from public.charity_remittances), 0),
    0
  )::integer into outstanding_cents;

  if p_amount_cents > outstanding_cents then
    raise exception 'The remittance exceeds the currently accrued outstanding amount.';
  end if;

  insert into public.charity_remittances (
    amount_cents, transferred_on, reference, notes, proof_path, created_by
  ) values (
    p_amount_cents,
    p_transferred_on,
    btrim(p_reference),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_proof_path, '')), ''),
    actor_id
  ) returning * into remittance_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'charity_remittance_recorded',
    'charity_remittance',
    remittance_row.id,
    jsonb_build_object(
      'amountCents', remittance_row.amount_cents,
      'transferredOn', remittance_row.transferred_on,
      'reference', remittance_row.reference
    )
  );

  return to_jsonb(remittance_row);
end;
$$;

create or replace function app_private.blog_markdown_is_safe(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    value is not null
    and char_length(btrim(value)) between 20 and 30000
    and value !~* '<\s*/?\s*(script|iframe|object|embed|form|style|html|svg|math)[^>]*>'
    and value !~* 'javascript\s*:'
    and value !~* 'data\s*:\s*text/html'
    and value !~ '!\[[^]]*\]\s*\(';
$$;

create or replace function app_private.blog_slug(title_value text, post_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from left(
    regexp_replace(lower(extensions.unaccent(coalesce(title_value, 'post'))), '[^a-z0-9]+', '-', 'g'),
    120
  )) || '-' || left(post_id::text, 8);
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
    and tipsters.is_verified = true
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
      and tipsters.is_verified = true
      and permissions.can_publish = true
      and app_private.current_user_account_active()
  );
$$;

create or replace function public.save_blog_post(
  p_post_id uuid,
  p_title text,
  p_excerpt text,
  p_body_markdown text,
  p_cover_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid := app_private.current_blog_tipster_id();
  post_row public.blog_posts%rowtype;
begin
  if tipster_id_value is null or not app_private.current_tipster_can_publish_blog() then
    raise exception 'Blog publishing permission is required to create or edit posts.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 5 and 160 then
    raise exception 'The post title must contain 5 to 160 characters.';
  end if;
  if char_length(btrim(coalesce(p_excerpt, ''))) not between 10 and 400 then
    raise exception 'The post excerpt must contain 10 to 400 characters.';
  end if;
  if not app_private.blog_markdown_is_safe(p_body_markdown) then
    raise exception 'The post body contains unsupported or unsafe content.';
  end if;
  if p_cover_image_path is not null
    and p_cover_image_path !~ ('^' || tipster_id_value::text || '/[0-9a-f-]{36}/cover-[0-9]+\.webp$')
  then
    raise exception 'The cover image path is invalid.';
  end if;

  if p_post_id is null then
    insert into public.blog_posts (
      tipster_id, title, excerpt, body_markdown, cover_image_path
    ) values (
      tipster_id_value,
      btrim(p_title),
      btrim(p_excerpt),
      btrim(p_body_markdown),
      nullif(btrim(coalesce(p_cover_image_path, '')), '')
    ) returning * into post_row;
  else
    select * into post_row
    from public.blog_posts
    where id = p_post_id
    for update;

    if post_row.id is null or post_row.tipster_id <> tipster_id_value then
      raise exception 'Blog post not found.';
    end if;
    if post_row.status in ('hidden', 'archived') then
      raise exception 'This post cannot be edited in its current state.';
    end if;
    update public.blog_posts
    set
      title = btrim(p_title),
      excerpt = btrim(p_excerpt),
      body_markdown = btrim(p_body_markdown),
      cover_image_path = nullif(btrim(coalesce(p_cover_image_path, '')), '')
    where id = post_row.id
    returning * into post_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when p_post_id is null then 'blog_post_created' else 'blog_post_saved' end,
    'blog_post',
    post_row.id,
    jsonb_build_object('status', post_row.status)
  );

  return to_jsonb(post_row);
end;
$$;

create or replace function public.publish_blog_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid := app_private.current_blog_tipster_id();
  post_row public.blog_posts%rowtype;
begin
  if tipster_id_value is null or not app_private.current_tipster_can_publish_blog() then
    raise exception 'Blog publishing permission is required.';
  end if;

  select * into post_row
  from public.blog_posts
  where id = p_post_id
  for update;

  if post_row.id is null or post_row.tipster_id <> tipster_id_value then
    raise exception 'Blog post not found.';
  end if;
  if post_row.status not in ('draft', 'published') then
    raise exception 'This post cannot be published in its current state.';
  end if;
  if not app_private.blog_markdown_is_safe(post_row.body_markdown) then
    raise exception 'The post body contains unsupported or unsafe content.';
  end if;

  update public.blog_posts
  set
    slug = coalesce(slug, app_private.blog_slug(title, id)),
    status = 'published',
    published_at = coalesce(published_at, now()),
    hidden_at = null,
    hidden_by = null,
    moderation_note = null
  where id = post_row.id
  returning * into post_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'blog_post_published',
    'blog_post',
    post_row.id,
    jsonb_build_object('slug', post_row.slug)
  );

  return to_jsonb(post_row);
end;
$$;

create or replace function public.archive_blog_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid := app_private.current_blog_tipster_id();
  post_row public.blog_posts%rowtype;
begin
  if tipster_id_value is null or not app_private.current_tipster_can_publish_blog() then
    raise exception 'Blog publishing permission is required.';
  end if;

  update public.blog_posts
  set status = 'archived'
  where id = p_post_id
    and tipster_id = tipster_id_value
    and status in ('draft', 'published')
  returning * into post_row;

  if post_row.id is null then
    raise exception 'Blog post not found.';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values ((select auth.uid()), 'blog_post_archived', 'blog_post', post_row.id);
  return to_jsonb(post_row);
end;
$$;

create or replace function public.create_blog_comment(p_post_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  body_value text := btrim(coalesce(p_body, ''));
  body_hash_value text;
  url_count integer;
  comment_row public.blog_comments%rowtype;
begin
  if actor_id is null
    or not app_private.current_user_account_active()
    or not app_private.current_user_has_role('client')
  then
    raise exception 'An active client account is required to comment.';
  end if;
  if char_length(body_value) not between 1 and 1500 then
    raise exception 'Comments must contain 1 to 1500 characters.';
  end if;
  if body_value ~* '<[^>]+>|javascript\s*:|data\s*:\s*text/html' then
    raise exception 'Comments must be plain text.';
  end if;

  select count(*)::integer into url_count
  from regexp_matches(body_value, 'https?://', 'gi');
  if coalesce(url_count, 0) > 2 then
    raise exception 'Comments may contain at most two links.';
  end if;
  if not exists (
    select 1 from public.blog_posts
    where id = p_post_id and status = 'published'
  ) then
    raise exception 'This blog post is not available for comments.';
  end if;
  if (
    select count(*) from public.blog_comments
    where user_id = actor_id and created_at >= now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'Comment limit reached. Please wait before posting again.';
  end if;

  body_hash_value := encode(
    extensions.digest(convert_to(lower(body_value), 'UTF8'), 'sha256'),
    'hex'
  );
  if exists (
    select 1 from public.blog_comments
    where user_id = actor_id
      and post_id = p_post_id
      and body_hash = body_hash_value
      and created_at >= now() - interval '24 hours'
  ) then
    raise exception 'This comment has already been submitted.';
  end if;

  insert into public.blog_comments (post_id, user_id, body, body_hash)
  values (p_post_id, actor_id, body_value, body_hash_value)
  returning * into comment_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (actor_id, 'blog_comment_created', 'blog_comment', comment_row.id);
  return to_jsonb(comment_row);
end;
$$;

create or replace function public.withdraw_blog_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comment_row public.blog_comments%rowtype;
begin
  update public.blog_comments
  set status = 'withdrawn'
  where id = p_comment_id
    and user_id = (select auth.uid())
    and status = 'visible'
  returning * into comment_row;

  if comment_row.id is null then
    raise exception 'Comment not found.';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values ((select auth.uid()), 'blog_comment_withdrawn', 'blog_comment', comment_row.id);
  return to_jsonb(comment_row);
end;
$$;

create or replace function public.report_blog_comment(p_comment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  report_row public.blog_comment_reports%rowtype;
begin
  if actor_id is null or not app_private.current_user_account_active() then
    raise exception 'Authentication required.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'Provide a report reason of 5 to 500 characters.';
  end if;
  if not exists (select 1 from public.blog_comments where id = p_comment_id) then
    raise exception 'Comment not found.';
  end if;

  insert into public.blog_comment_reports (comment_id, reported_by, reason)
  values (p_comment_id, actor_id, btrim(p_reason))
  returning * into report_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (actor_id, 'blog_comment_reported', 'blog_comment', p_comment_id);
  return to_jsonb(report_row);
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
  tipster_row public.tipsters%rowtype;
  permission_row public.tipster_blog_permissions%rowtype;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'An audit reason of 5 to 500 characters is required.';
  end if;

  select * into tipster_row
  from public.tipsters
  where user_id = p_user_id;
  if tipster_row.id is null
    or (p_can_publish and not tipster_row.is_verified)
    or (p_can_publish and not app_private.account_is_active(p_user_id))
  then
    raise exception 'An active verified tipster is required for blog publishing.';
  end if;

  insert into public.tipster_blog_permissions (
    tipster_id, can_publish, granted_by, granted_at, reason
  ) values (
    tipster_row.id,
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

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'tipster_blog_permission_changed',
    'tipster',
    tipster_row.id,
    jsonb_build_object('canPublish', p_can_publish, 'reason', btrim(p_reason))
  );
  return to_jsonb(permission_row);
end;
$$;

create or replace function public.admin_moderate_blog_post(
  p_post_id uuid,
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
  post_row public.blog_posts%rowtype;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if lower(coalesce(p_action, '')) not in ('hide', 'restore', 'archive') then
    raise exception 'Choose hide, restore, or archive.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'A moderation note of 5 to 2000 characters is required.';
  end if;

  update public.blog_posts
  set
    status = case lower(p_action)
      when 'hide' then 'hidden'
      when 'restore' then 'published'
      else 'archived'
    end,
    hidden_at = case when lower(p_action) = 'hide' then now() else null end,
    hidden_by = case when lower(p_action) = 'hide' then actor_id else null end,
    moderation_note = btrim(p_note),
    published_at = case
      when lower(p_action) = 'restore' then coalesce(published_at, now())
      else published_at
    end
  where id = p_post_id
  returning * into post_row;

  if post_row.id is null then raise exception 'Blog post not found.'; end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'blog_post_' || lower(p_action),
    'blog_post',
    post_row.id,
    jsonb_build_object('note', btrim(p_note))
  );
  return to_jsonb(post_row);
end;
$$;

create or replace function public.admin_moderate_blog_comment(
  p_comment_id uuid,
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
  comment_row public.blog_comments%rowtype;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if lower(coalesce(p_action, '')) not in ('hide', 'restore') then
    raise exception 'Choose hide or restore.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'A moderation note of 5 to 2000 characters is required.';
  end if;

  update public.blog_comments
  set
    status = case when lower(p_action) = 'hide' then 'hidden' else 'visible' end,
    hidden_at = case when lower(p_action) = 'hide' then now() else null end,
    hidden_by = case when lower(p_action) = 'hide' then actor_id else null end,
    moderation_note = btrim(p_note)
  where id = p_comment_id
  returning * into comment_row;
  if comment_row.id is null then raise exception 'Comment not found.'; end if;

  update public.blog_comment_reports
  set
    status = case when lower(p_action) = 'hide' then 'reviewed' else 'dismissed' end,
    reviewed_by = actor_id,
    reviewed_at = now()
  where comment_id = comment_row.id and status = 'open';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'blog_comment_' || lower(p_action),
    'blog_comment',
    comment_row.id,
    jsonb_build_object('note', btrim(p_note))
  );
  return to_jsonb(comment_row);
end;
$$;

create or replace function public.list_public_blog_posts(p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by item ->> 'publishedAt' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', posts.id,
      'slug', posts.slug,
      'title', posts.title,
      'excerpt', posts.excerpt,
      'coverImagePath', posts.cover_image_path,
      'publishedAt', posts.published_at,
      'updatedAt', posts.updated_at,
      'author', tipsters.display_name,
      'commentCount', (
        select count(*) from public.blog_comments comments
        where comments.post_id = posts.id and comments.status = 'visible'
      )
    ) as item
    from public.blog_posts posts
    join public.tipsters tipsters on tipsters.id = posts.tipster_id
    where posts.status = 'published'
    order by posts.published_at desc
    limit greatest(1, least(coalesce(p_limit, 24), 100))
  ) public_posts;
$$;

create or replace function public.get_public_blog_post(p_slug text)
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
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', comments.id,
        'body', comments.body,
        'author', coalesce(nullif(btrim(profiles.display_name), ''), 'MRC client'),
        'isMine', comments.user_id = (select auth.uid()),
        'createdAt', comments.created_at
      ) order by comments.created_at)
      from public.blog_comments comments
      left join public.profiles profiles on profiles.id = comments.user_id
      where comments.post_id = posts.id and comments.status = 'visible'
    ), '[]'::jsonb)
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.status = 'published' and posts.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function app_private.settle_completed_tip_cards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settled_count integer := 0;
begin
  update public.tip_cards cards
  set status = 'settled'
  from public.race_meetings meetings
  where meetings.id = cards.meeting_id
    and meetings.status = 'completed'
    and cards.status = 'published';
  get diagnostics settled_count = row_count;

  insert into public.tip_card_race_outcomes (
    tip_card_id,
    fixture_id,
    selected_winner_entry_id,
    selected_winner_position,
    winner_hit,
    selected_place_entry_id,
    selected_place_position,
    official_winner_entry_id,
    result_summary,
    evidence_hash,
    settled_at
  )
  select
    cards.id,
    fixtures.id,
    selections.winner_entry_id,
    selected_winner.result_position,
    case
      when selections.winner_entry_id is null or selected_winner.result_position is null then null
      else selected_winner.result_position = 1
    end,
    selections.place_entry_id,
    selected_place.result_position,
    official_winner.id,
    fixtures.result_summary,
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'fixtureId', fixtures.id,
            'resultSummary', fixtures.result_summary,
            'winnerEntryId', official_winner.id,
            'winnerPosition', selected_winner.result_position,
            'placePosition', selected_place.result_position,
            'sourceUpdatedAt', fixtures.source_updated_at
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    now()
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  join public.fixtures fixtures on fixtures.meeting_id = meetings.id
  left join public.race_tip_selections selections
    on selections.tip_card_id = cards.id
    and selections.fixture_id = fixtures.id
  left join public.race_entries selected_winner on selected_winner.id = selections.winner_entry_id
  left join public.race_entries selected_place on selected_place.id = selections.place_entry_id
  left join public.race_entries official_winner
    on official_winner.fixture_id = fixtures.id
    and official_winner.result_position = 1
  where cards.status = 'settled'
    and meetings.status = 'completed'
    and fixtures.status in ('completed', 'cancelled', 'abandoned')
  on conflict (tip_card_id, fixture_id) do nothing;

  perform app_private.refresh_tipster_performance_stats();
  return settled_count;
end;
$$;

create or replace function app_private.refresh_tipster_performance_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tipster_performance_stats (
    tipster_id,
    published_winner_tips,
    settled_winner_tips,
    winner_hits,
    winner_strike_rate,
    roi_percent,
    updated_at
  )
  select
    tipsters.id,
    count(outcomes.id) filter (where outcomes.selected_winner_entry_id is not null)::integer,
    count(outcomes.id) filter (
      where outcomes.selected_winner_entry_id is not null
        and outcomes.selected_winner_position is not null
    )::integer,
    count(outcomes.id) filter (where outcomes.winner_hit = true)::integer,
    case
      when count(outcomes.id) filter (
        where outcomes.selected_winner_entry_id is not null
          and outcomes.selected_winner_position is not null
      ) = 0 then null
      else round(
        count(outcomes.id) filter (where outcomes.winner_hit = true)::numeric
          / count(outcomes.id) filter (
            where outcomes.selected_winner_entry_id is not null
              and outcomes.selected_winner_position is not null
          )::numeric * 100,
        2
      )
    end,
    null::numeric,
    now()
  from public.tipsters tipsters
  left join public.tip_cards cards
    on cards.tipster_id = tipsters.id
    and cards.status = 'settled'
  left join public.tip_card_race_outcomes outcomes on outcomes.tip_card_id = cards.id
  where tipsters.is_verified = true
  group by tipsters.id
  on conflict (tipster_id) do update
  set
    published_winner_tips = excluded.published_winner_tips,
    settled_winner_tips = excluded.settled_winner_tips,
    winner_hits = excluded.winner_hits,
    winner_strike_rate = excluded.winner_strike_rate,
    roi_percent = excluded.roi_percent,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.run_race_lifecycle(
  p_dry_run boolean default false,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_meetings integer := 0;
  voidable_cards integer := 0;
  voided_cards integer := 0;
  queued_tasks integer := 0;
  failed_tasks integer := 0;
  completed_meetings integer := 0;
  settled_cards integer := 0;
  refunded_purchases integer := 0;
  source_id_value uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select count(*)::integer into started_meetings
  from public.race_meetings
  where status = 'scheduled' and first_race_at <= now();

  select count(*)::integer into voidable_cards
  from public.tip_cards cards
  join public.race_meetings meetings on meetings.id = cards.meeting_id
  where cards.status in ('draft', 'coming_soon')
    and meetings.first_race_at <= now();

  if p_dry_run then
    select count(*)::integer into queued_tasks
    from public.fixtures fixtures
    join public.race_meetings meetings on meetings.id = fixtures.meeting_id
    where not meetings.is_test
      and fixtures.starts_at <= now()
      and fixtures.status not in ('completed', 'cancelled', 'abandoned')
      and not exists (
        select 1 from public.race_entries entries
        where entries.fixture_id = fixtures.id and entries.result_position = 1
      )
      and coalesce(meetings.last_race_at, fixtures.starts_at) >= now() - interval '48 hours';

    return jsonb_build_object(
      'dryRun', true,
      'startedMeetings', started_meetings,
      'voidableCards', voidable_cards,
      'resultTasksDue', queued_tasks,
      'checkedAt', now()
    );
  end if;

  update public.race_meetings
  set status = 'in_progress'
  where status = 'scheduled' and first_race_at <= now();

  update public.fixtures
  set status = 'in_progress'
  where status = 'scheduled' and starts_at <= now();

  update public.tip_cards cards
  set status = 'void', voided_at = coalesce(voided_at, now())
  from public.race_meetings meetings
  where meetings.id = cards.meeting_id
    and cards.status in ('draft', 'coming_soon')
    and meetings.first_race_at <= now();
  get diagnostics voided_cards = row_count;

  refunded_purchases := app_private.refund_due_meeting_purchases();
  source_id_value := app_private.ensure_hermes_local_source();

  update public.race_feed_tasks
  set
    state = 'cancelled',
    locked_at = null,
    locked_by = null,
    last_error = 'Replaced by per-fixture result polling.',
    updated_at = now()
  where task_type = 'result_refresh'
    and fixture_id is null
    and state in ('pending', 'failed');

  insert into public.race_feed_tasks (
    source_id,
    task_key,
    task_type,
    meeting_id,
    fixture_id,
    meeting_external_id,
    venue,
    meeting_date,
    race_number,
    task_payload,
    due_at,
    max_attempts
  )
  select
    source_id_value,
    'result-refresh:' || fixtures.id::text,
    'result_refresh',
    meetings.id,
    fixtures.id,
    meetings.external_id,
    meetings.venue,
    meetings.meeting_date,
    fixtures.race_number,
    jsonb_build_object(
      'meetingId', meetings.id,
      'fixtureId', fixtures.id,
      'meetingExternalId', meetings.external_id,
      'venue', meetings.venue,
      'meetingDate', meetings.meeting_date,
      'raceNumber', fixtures.race_number,
      'provider', 'hermes',
      'delegate_to_hermes', true,
      'permitted_sources', jsonb_build_array('formgrids.info', 'raceform.co.za')
    ),
    greatest(fixtures.starts_at + interval '10 minutes', now()),
    192
  from public.fixtures fixtures
  join public.race_meetings meetings on meetings.id = fixtures.meeting_id
  where not meetings.is_test
    and fixtures.starts_at <= now()
    and fixtures.status not in ('completed', 'cancelled', 'abandoned')
    and not exists (
      select 1 from public.race_entries entries
      where entries.fixture_id = fixtures.id and entries.result_position = 1
    )
    and coalesce(meetings.last_race_at, fixtures.starts_at) >= now() - interval '48 hours'
  on conflict (task_key) do update
  set
    source_id = excluded.source_id,
    meeting_id = excluded.meeting_id,
    fixture_id = excluded.fixture_id,
    meeting_external_id = excluded.meeting_external_id,
    venue = excluded.venue,
    meeting_date = excluded.meeting_date,
    race_number = excluded.race_number,
    task_payload = excluded.task_payload,
    max_attempts = 192,
    state = case
      when public.race_feed_tasks.state = 'running' then 'running'
      when public.race_feed_tasks.attempts >= 192 then 'failed'
      when exists (
        select 1 from public.race_feed_proposals proposals
        where proposals.source_task_id = public.race_feed_tasks.id
          and proposals.status in ('pending', 'quarantined')
      ) then public.race_feed_tasks.state
      else 'pending'
    end,
    due_at = case
      when public.race_feed_tasks.last_completed_at is null
        then greatest(excluded.due_at, now())
      when now() <= coalesce((
        select last_race_at + interval '2 hours'
        from public.race_meetings
        where id = excluded.meeting_id
      ), now())
        then greatest(excluded.due_at, public.race_feed_tasks.last_completed_at + interval '10 minutes')
      else greatest(excluded.due_at, public.race_feed_tasks.last_completed_at + interval '1 hour')
    end,
    locked_at = case when public.race_feed_tasks.state = 'running' then public.race_feed_tasks.locked_at else null end,
    locked_by = case when public.race_feed_tasks.state = 'running' then public.race_feed_tasks.locked_by else null end,
    last_error = case when public.race_feed_tasks.attempts >= 192 then public.race_feed_tasks.last_error else null end,
    updated_at = now()
  where not exists (
    select 1 from public.race_feed_proposals proposals
    where proposals.source_task_id = public.race_feed_tasks.id
      and proposals.status in ('pending', 'quarantined')
  );
  get diagnostics queued_tasks = row_count;

  update public.race_feed_tasks tasks
  set
    state = 'failed',
    locked_at = null,
    locked_by = null,
    last_error = 'No validated official result was available within 48 hours.',
    updated_at = now()
  from public.race_meetings meetings
  where meetings.id = tasks.meeting_id
    and tasks.task_type = 'result_refresh'
    and tasks.fixture_id is not null
    and coalesce(meetings.last_race_at, meetings.first_race_at) < now() - interval '48 hours'
    and tasks.state not in ('completed', 'cancelled');
  get diagnostics failed_tasks = row_count;

  update public.race_meetings meetings
  set status = 'completed'
  where meetings.status in ('scheduled', 'in_progress')
    and exists (select 1 from public.fixtures fixtures where fixtures.meeting_id = meetings.id)
    and not exists (
      select 1 from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
        and fixtures.status not in ('completed', 'cancelled', 'abandoned')
    );
  get diagnostics completed_meetings = row_count;

  settled_cards := app_private.settle_completed_tip_cards();

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    p_actor_id,
    'race_lifecycle_completed',
    'race_lifecycle',
    jsonb_build_object(
      'startedMeetings', started_meetings,
      'voidedCards', voided_cards,
      'refundedPurchases', refunded_purchases,
      'resultTasksTouched', queued_tasks,
      'failedTasks', failed_tasks,
      'completedMeetings', completed_meetings,
      'settledCards', settled_cards
    )
  );

  return jsonb_build_object(
    'dryRun', false,
    'startedMeetings', started_meetings,
    'voidedCards', voided_cards,
    'refundedPurchases', refunded_purchases,
    'resultTasksTouched', queued_tasks,
    'failedTasks', failed_tasks,
    'completedMeetings', completed_meetings,
    'settledCards', settled_cards,
    'checkedAt', now()
  );
end;
$$;

create or replace function app_private.auto_apply_validated_formgrids_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.race_feed_tasks%rowtype;
  fixture_row public.fixtures%rowtype;
  race_payload jsonb;
  runner_count integer;
  positioned_count integer;
  distinct_position_count integer;
  winner_count integer;
  invalid_runner_count integer;
  apply_result_value jsonb;
begin
  if new.change_type <> 'result'
    or new.status <> 'pending'
    or new.applied_at is not null
  then
    return new;
  end if;

  select * into task_row
  from public.race_feed_tasks
  where id = new.source_task_id;
  if task_row.id is null or task_row.fixture_id is null or task_row.race_number is null then
    return new;
  end if;

  select * into fixture_row
  from public.fixtures
  where id = task_row.fixture_id;
  if fixture_row.id is null then return new; end if;

  if task_row.race_number is distinct from fixture_row.race_number
    or task_row.meeting_date is distinct from new.meeting_date
    or lower(btrim(coalesce(task_row.venue, ''))) is distinct from lower(btrim(new.venue))
  then
    update public.race_feed_proposals
    set
      status = 'quarantined',
      auto_approval_eligible = false,
      review_note = 'Venue, meeting date, race number, and fixture identity did not match the polling task.'
    where id = new.id;
    return new;
  end if;

  if new.snapshot::text ~* '"(odds|bookmaker|dividend|market)"\s*:' then
    update public.race_feed_proposals
    set
      status = 'quarantined',
      auto_approval_eligible = false,
      review_note = 'Prohibited betting-market data was present in the proposed result.'
    where id = new.id;
    return new;
  end if;

  if new.has_critical_conflict then
    update public.race_feed_proposals
    set
      status = 'quarantined',
      auto_approval_eligible = false,
      review_note = coalesce(conflict_summary, 'Material result-source conflict requires administrator review.')
    where id = new.id;
    return new;
  end if;

  if not exists (
    select 1
    from public.race_feed_evidence evidence
    join public.race_source_domains domains on domains.id = evidence.domain_id
    where evidence.proposal_id = new.id
      and domains.domain = 'formgrids.info'
      and domains.status = 'approved'
      and domains.can_auto_approve = true
      and evidence.retrieved_at >= fixture_row.starts_at
  ) then
    update public.race_feed_proposals
    set
      status = 'failed',
      auto_approval_eligible = false,
      review_note = 'Authenticated Formgrids evidence retrieved after race start is required; polling will retry.'
    where id = new.id;
    return new;
  end if;

  select race into race_payload
  from jsonb_array_elements(new.snapshot -> 'meetings') meeting,
       jsonb_array_elements(meeting -> 'races') race
  where (race ->> 'raceNumber')::integer = task_row.race_number
  limit 1;

  if race_payload is null
    or coalesce(race_payload ->> 'status', '') <> 'completed'
    or nullif(btrim(coalesce(race_payload ->> 'resultSummary', '')), '') is null
    or jsonb_typeof(race_payload -> 'runners') <> 'array'
  then
    update public.race_feed_proposals
    set
      status = 'failed',
      auto_approval_eligible = false,
      review_note = 'The official result is incomplete; polling will retry.'
    where id = new.id;
    return new;
  end if;

  select
    count(*)::integer,
    count(*) filter (where nullif(runner ->> 'resultPosition', '') is not null)::integer,
    count(distinct (runner ->> 'resultPosition')::integer)
      filter (where nullif(runner ->> 'resultPosition', '') is not null)::integer,
    count(*) filter (where (runner ->> 'resultPosition')::integer = 1)::integer
  into runner_count, positioned_count, distinct_position_count, winner_count
  from jsonb_array_elements(race_payload -> 'runners') runner;

  if runner_count = 0 or positioned_count = 0 then
    update public.race_feed_proposals
    set
      status = 'failed',
      auto_approval_eligible = false,
      review_note = 'The official result does not yet contain finishing positions; polling will retry.'
    where id = new.id;
    return new;
  end if;

  if positioned_count <> distinct_position_count or winner_count <> 1 then
    update public.race_feed_proposals
    set
      status = 'quarantined',
      auto_approval_eligible = false,
      review_note = 'The official result contains duplicate positions or does not contain exactly one winner.'
    where id = new.id;
    return new;
  end if;

  select count(*)::integer into invalid_runner_count
  from jsonb_array_elements(race_payload -> 'runners') runner
  where (
      coalesce(runner ->> 'status', 'active') in ('scratched', 'withdrawn')
      and nullif(runner ->> 'resultPosition', '') is not null
    )
    or (
      nullif(runner ->> 'resultPosition', '') is not null
      and not exists (
        select 1
        from public.race_entries entries
        where entries.fixture_id = task_row.fixture_id
          and entries.saddle_number = (runner ->> 'saddleNumber')::integer
          and regexp_replace(lower(entries.horse_name), '[^a-z0-9]+', '', 'g') =
              regexp_replace(lower(runner ->> 'horseName'), '[^a-z0-9]+', '', 'g')
      )
    );
  if invalid_runner_count > 0 then
    update public.race_feed_proposals
    set
      status = 'quarantined',
      auto_approval_eligible = false,
      review_note = 'One or more finishers could not be mapped safely, or a non-runner had a finishing position.'
    where id = new.id;
    return new;
  end if;

  apply_result_value := app_private.apply_race_snapshot(
    new.run_id,
    new.source_id,
    new.snapshot,
    false
  );

  update public.race_feed_proposals
  set
    status = case
      when apply_result_value ->> 'status' = 'succeeded' then 'auto_approved'
      else 'quarantined'
    end,
    auto_approval_eligible = apply_result_value ->> 'status' = 'succeeded',
    applied_at = case when apply_result_value ->> 'status' = 'succeeded' then now() else null end,
    apply_result = apply_result_value
  where id = new.id;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'formgrids_result_auto_reviewed',
    'race_feed_proposal',
    new.id,
    jsonb_build_object(
      'fixtureId', task_row.fixture_id,
      'raceNumber', task_row.race_number,
      'status', apply_result_value ->> 'status'
    )
  );

  return new;
end;
$$;

drop trigger if exists auto_apply_validated_formgrids_result on public.race_feed_proposals;
create trigger auto_apply_validated_formgrids_result
after update of confidence_score, status on public.race_feed_proposals
for each row execute function app_private.auto_apply_validated_formgrids_result();

create or replace function public.finalize_auto_applied_race_result(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.race_feed_proposals%rowtype;
  task_row public.race_feed_tasks%rowtype;
  completed_meetings integer := 0;
  settled_cards integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select * into proposal_row
  from public.race_feed_proposals
  where id = p_proposal_id;

  if proposal_row.id is null then
    raise exception 'Race-feed proposal not found.';
  end if;
  if proposal_row.status <> 'auto_approved' or proposal_row.applied_at is null then
    return jsonb_build_object(
      'status', proposal_row.status,
      'finalized', false,
      'proposalId', proposal_row.id
    );
  end if;

  select * into task_row
  from public.race_feed_tasks
  where id = proposal_row.source_task_id;

  update public.race_feed_tasks
  set
    state = 'completed',
    locked_at = null,
    locked_by = null,
    last_error = null,
    last_completed_at = now()
  where id = task_row.id;

  update public.race_feed_runs
  set
    status = 'succeeded',
    completed_at = now(),
    error_code = null,
    error_message = null
  where id = proposal_row.run_id;

  update public.race_meetings meetings
  set status = 'completed'
  where meetings.id = task_row.meeting_id
    and meetings.status in ('scheduled', 'in_progress')
    and exists (select 1 from public.fixtures fixtures where fixtures.meeting_id = meetings.id)
    and not exists (
      select 1 from public.fixtures fixtures
      where fixtures.meeting_id = meetings.id
        and fixtures.status not in ('completed', 'cancelled', 'abandoned')
    );
  get diagnostics completed_meetings = row_count;

  settled_cards := app_private.settle_completed_tip_cards();
  return jsonb_build_object(
    'status', proposal_row.status,
    'finalized', true,
    'proposalId', proposal_row.id,
    'taskId', task_row.id,
    'completedMeetings', completed_meetings,
    'settledCards', settled_cards
  );
end;
$$;

update public.race_source_domains
set
  status = 'approved',
  reliability_score = 100,
  direct_fetch_allowed = true,
  can_auto_approve = true,
  reuse_basis = 'Authenticated Formgrids evidence authorized by the account owner; validated official results may auto-apply.',
  last_reviewed_at = now(),
  updated_at = now()
where domain = 'formgrids.info';

update public.race_feed_settings
set auto_approve_results = true, updated_at = now()
where singleton = true;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'blog-media',
  'blog-media',
  true,
  5242880,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.configure_race_lifecycle_schedule(p_project_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id bigint;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;
  if p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'Provide the canonical Supabase project URL.';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'mrc_race_worker_token'
  ) then
    raise exception 'The MRC race worker token is not configured.';
  end if;

  perform cron.unschedule('mrc-race-lifecycle')
  where exists (select 1 from cron.job where jobname = 'mrc-race-lifecycle');

  job_id := cron.schedule(
    'mrc-race-lifecycle',
    '*/5 * * * *',
    format(
      $command$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-mrc-worker-token', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'mrc_race_worker_token'
              limit 1
            )
          ),
          body := jsonb_build_object('trigger', 'cron', 'dryRun', false),
          timeout_milliseconds := 30000
        );
      $command$,
      rtrim(p_project_url, '/') || '/functions/v1/race-lifecycle'
    )
  );

  return jsonb_build_object(
    'jobId', job_id,
    'jobName', 'mrc-race-lifecycle',
    'schedule', '*/5 * * * *'
  );
end;
$$;

do $$
begin
  if exists (
    select 1 from vault.decrypted_secrets where name = 'mrc_race_worker_token'
  ) then
    perform cron.unschedule('mrc-race-lifecycle')
    where exists (select 1 from cron.job where jobname = 'mrc-race-lifecycle');

    perform cron.schedule(
      'mrc-race-lifecycle',
      '*/5 * * * *',
      $command$
        select net.http_post(
          url := 'https://cjgfvqgiqrphmakruqnk.supabase.co/functions/v1/race-lifecycle',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-mrc-worker-token', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'mrc_race_worker_token'
              limit 1
            )
          ),
          body := jsonb_build_object('trigger', 'cron', 'dryRun', false),
          timeout_milliseconds := 30000
        );
      $command$
    );
  end if;
end;
$$;

alter table public.tip_card_race_outcomes enable row level security;
alter table public.charity_contribution_entries enable row level security;
alter table public.charity_remittances enable row level security;
alter table public.tipster_blog_permissions enable row level security;
alter table public.blog_posts enable row level security;
alter table public.blog_comments enable row level security;
alter table public.blog_comment_reports enable row level security;

create policy tip_card_race_outcomes_read
on public.tip_card_race_outcomes for select
to authenticated
using (
  app_private.current_user_has_role('administrator')
  or app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1 from public.tip_cards cards
    join public.tipsters tipsters on tipsters.id = cards.tipster_id
    where cards.id = tip_card_id and tipsters.user_id = (select auth.uid())
  )
);

create policy charity_contribution_entries_admin_read
on public.charity_contribution_entries for select
to authenticated
using (app_private.current_user_has_role('administrator'));

create policy charity_remittances_admin_read
on public.charity_remittances for select
to authenticated
using (app_private.current_user_has_role('administrator'));

create policy tipster_blog_permissions_read
on public.tipster_blog_permissions for select
to authenticated
using (
  app_private.current_user_has_role('administrator')
  or exists (
    select 1 from public.tipsters
    where tipsters.id = tipster_blog_permissions.tipster_id
      and tipsters.user_id = (select auth.uid())
  )
);

create policy blog_posts_read
on public.blog_posts for select
to anon, authenticated
using (
  status = 'published'
  or app_private.current_user_has_role('administrator')
  or exists (
    select 1 from public.tipsters
    where tipsters.id = blog_posts.tipster_id
      and tipsters.user_id = (select auth.uid())
  )
);

create policy blog_comments_read
on public.blog_comments for select
to anon, authenticated
using (
  status = 'visible'
  or user_id = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

create policy blog_comment_reports_read
on public.blog_comment_reports for select
to authenticated
using (
  reported_by = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

revoke all on public.tip_card_race_outcomes from anon, authenticated;
revoke all on public.charity_contribution_entries from anon, authenticated;
revoke all on public.charity_remittances from anon, authenticated;
revoke all on public.tipster_blog_permissions from anon, authenticated;
revoke all on public.blog_posts from anon, authenticated;
revoke all on public.blog_comments from anon, authenticated;
revoke all on public.blog_comment_reports from anon, authenticated;

grant select on public.tip_card_race_outcomes to authenticated;
grant select on public.charity_contribution_entries, public.charity_remittances to authenticated;
grant select on public.tipster_blog_permissions to authenticated;
grant select on public.blog_posts to anon, authenticated;
grant select (id, post_id, body, status, moderation_note, created_at, updated_at)
  on public.blog_comments to anon, authenticated;
grant select on public.blog_comment_reports to authenticated;

revoke all on function app_private.reject_immutable_record_change() from public, anon, authenticated;
revoke all on function app_private.enforce_tip_card_meeting_window() from public, anon, authenticated;
revoke all on function app_private.enforce_meeting_purchase_cutoff() from public, anon, authenticated;
revoke all on function app_private.record_charity_contribution() from public, anon, authenticated;
revoke all on function app_private.blog_markdown_is_safe(text) from public, anon, authenticated;
revoke all on function app_private.blog_slug(text, uuid) from public, anon, authenticated;
revoke all on function app_private.current_blog_tipster_id() from public, anon, authenticated;
revoke all on function app_private.current_tipster_can_publish_blog() from public, anon, authenticated;
revoke all on function app_private.settle_completed_tip_cards() from public, anon, authenticated;
revoke all on function app_private.auto_apply_validated_formgrids_result() from public, anon, authenticated;
revoke all on function public.run_race_lifecycle(boolean, uuid) from public, anon, authenticated;
grant execute on function public.run_race_lifecycle(boolean, uuid) to service_role;
revoke all on function public.finalize_auto_applied_race_result(uuid) from public, anon, authenticated;
grant execute on function public.finalize_auto_applied_race_result(uuid) to service_role;

revoke all on function public.get_charity_transparency() from public;
grant execute on function public.get_charity_transparency() to anon, authenticated;
revoke all on function public.admin_record_charity_remittance(integer, date, text, text, text) from public, anon;
grant execute on function public.admin_record_charity_remittance(integer, date, text, text, text) to authenticated;
revoke all on function public.save_blog_post(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_blog_post(uuid, text, text, text, text) to authenticated;
revoke all on function public.publish_blog_post(uuid) from public, anon;
grant execute on function public.publish_blog_post(uuid) to authenticated;
revoke all on function public.archive_blog_post(uuid) from public, anon;
grant execute on function public.archive_blog_post(uuid) to authenticated;
revoke all on function public.create_blog_comment(uuid, text) from public, anon;
grant execute on function public.create_blog_comment(uuid, text) to authenticated;
revoke all on function public.withdraw_blog_comment(uuid) from public, anon;
grant execute on function public.withdraw_blog_comment(uuid) to authenticated;
revoke all on function public.report_blog_comment(uuid, text) from public, anon;
grant execute on function public.report_blog_comment(uuid, text) to authenticated;
revoke all on function public.admin_set_tipster_blog_permission(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_tipster_blog_permission(uuid, boolean, text) to authenticated;
revoke all on function public.admin_moderate_blog_post(uuid, text, text) from public, anon;
grant execute on function public.admin_moderate_blog_post(uuid, text, text) to authenticated;
revoke all on function public.admin_moderate_blog_comment(uuid, text, text) from public, anon;
grant execute on function public.admin_moderate_blog_comment(uuid, text, text) to authenticated;
revoke all on function public.list_public_blog_posts(integer) from public;
grant execute on function public.list_public_blog_posts(integer) to anon, authenticated;
revoke all on function public.get_public_blog_post(text) from public;
grant execute on function public.get_public_blog_post(text) to anon, authenticated;
revoke all on function public.configure_race_lifecycle_schedule(text) from public, anon;
grant execute on function public.configure_race_lifecycle_schedule(text) to authenticated;

select app_private.refresh_tipster_performance_stats();
