alter table public.fixtures
  add column if not exists source_name text not null default 'manual',
  add column if not exists source_url text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_payload jsonb not null default '{}'::jsonb;

create unique index if not exists fixtures_source_external_id_uidx
  on public.fixtures (source_name, external_id);

create index if not exists fixtures_upcoming_idx
  on public.fixtures (starts_at)
  where result_summary is null;

create index if not exists fixtures_results_history_idx
  on public.fixtures (starts_at desc)
  where result_summary is not null;

update public.sports
set is_active = (slug = 'horse-racing');
