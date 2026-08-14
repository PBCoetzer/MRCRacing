create or replace function public.get_race_llm_configuration()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  configuration jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select jsonb_build_object(
    'baseUrl', max(decrypted_secret) filter (where name = 'mrc_race_llm_base_url'),
    'apiKey', max(decrypted_secret) filter (where name = 'mrc_race_llm_api_key'),
    'model', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_model'),
      'gemini-3.6-flash'
    ),
    'searchModel', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_search_model'),
      'gemini-2.5-flash'
    ),
    'extractionModel', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_extraction_model'),
      max(decrypted_secret) filter (where name = 'mrc_race_llm_model'),
      'gemini-3.6-flash'
    ),
    'responseMode', coalesce(
      max(decrypted_secret) filter (where name = 'mrc_race_llm_response_mode'),
      'json_schema'
    )
  )
  into configuration
  from vault.decrypted_secrets
  where name in (
    'mrc_race_llm_base_url',
    'mrc_race_llm_api_key',
    'mrc_race_llm_model',
    'mrc_race_llm_search_model',
    'mrc_race_llm_extraction_model',
    'mrc_race_llm_response_mode'
  );

  return coalesce(configuration, '{}'::jsonb);
end;
$$;

alter table public.race_feed_settings enable row level security;
alter table public.race_source_domains enable row level security;
alter table public.race_feed_tasks enable row level security;
alter table public.race_feed_fragments enable row level security;
alter table public.race_feed_proposals enable row level security;
alter table public.race_feed_evidence enable row level security;
alter table public.race_feed_proposal_reviews enable row level security;

drop policy if exists race_feed_settings_admin_read on public.race_feed_settings;
create policy race_feed_settings_admin_read
on public.race_feed_settings
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_source_domains_admin_read on public.race_source_domains;
create policy race_source_domains_admin_read
on public.race_source_domains
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_tasks_admin_read on public.race_feed_tasks;
create policy race_feed_tasks_admin_read
on public.race_feed_tasks
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_fragments_admin_read on public.race_feed_fragments;
create policy race_feed_fragments_admin_read
on public.race_feed_fragments
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_proposals_admin_read on public.race_feed_proposals;
create policy race_feed_proposals_admin_read
on public.race_feed_proposals
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_evidence_admin_read on public.race_feed_evidence;
create policy race_feed_evidence_admin_read
on public.race_feed_evidence
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

drop policy if exists race_feed_proposal_reviews_admin_read on public.race_feed_proposal_reviews;
create policy race_feed_proposal_reviews_admin_read
on public.race_feed_proposal_reviews
for select
to authenticated
using (app_private.current_user_has_role('administrator'));

revoke all on table public.race_feed_settings from public, anon, authenticated;
revoke all on table public.race_source_domains from public, anon, authenticated;
revoke all on table public.race_feed_tasks from public, anon, authenticated;
revoke all on table public.race_feed_fragments from public, anon, authenticated;
revoke all on table public.race_feed_proposals from public, anon, authenticated;
revoke all on table public.race_feed_evidence from public, anon, authenticated;
revoke all on table public.race_feed_proposal_reviews from public, anon, authenticated;

grant select on table public.race_feed_settings to authenticated;
grant select on table public.race_source_domains to authenticated;
grant select on table public.race_feed_tasks to authenticated;
grant select on table public.race_feed_fragments to authenticated;
grant select on table public.race_feed_proposals to authenticated;
grant select on table public.race_feed_evidence to authenticated;
grant select on table public.race_feed_proposal_reviews to authenticated;

grant all on table public.race_feed_settings to service_role;
grant all on table public.race_source_domains to service_role;
grant all on table public.race_feed_tasks to service_role;
grant all on table public.race_feed_fragments to service_role;
grant all on table public.race_feed_proposals to service_role;
grant all on table public.race_feed_evidence to service_role;
grant all on table public.race_feed_proposal_reviews to service_role;

revoke all on function public.claim_race_feed_task_plan(text, text) from public, anon, authenticated;
grant execute on function public.claim_race_feed_task_plan(text, text) to service_role;

revoke all on function public.complete_race_feed_task_plan(uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_race_feed_task_plan(uuid, uuid, text, text, text, integer, integer, jsonb, timestamptz) to service_role;

revoke all on function public.submit_race_feed_proposal(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, numeric, numeric, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_race_feed_proposal(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, numeric, numeric, boolean, text, uuid, text) to service_role;

revoke all on function public.admin_review_race_feed_proposal(uuid, text, text) from public, anon;
grant execute on function public.admin_review_race_feed_proposal(uuid, text, text) to authenticated;

revoke all on function public.admin_request_race_feed_research(text, uuid) from public, anon;
grant execute on function public.admin_request_race_feed_research(text, uuid) to authenticated;

revoke all on function public.admin_update_race_feed_settings(integer, integer, boolean, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.admin_update_race_feed_settings(integer, integer, boolean, boolean, boolean, integer, integer) to authenticated;

revoke all on function public.admin_upsert_race_source_domain(text, text, text, integer, text, boolean, boolean) from public, anon;
grant execute on function public.admin_upsert_race_source_domain(text, text, text, integer, text, boolean, boolean) to authenticated;

revoke all on function public.get_race_llm_configuration() from public, anon, authenticated;
grant execute on function public.get_race_llm_configuration() to service_role;

revoke all on function app_private.normalize_race_source_domain(text) from public, anon, authenticated;
revoke all on function app_private.ensure_gemini_race_feed_source() from public, anon, authenticated;
;
