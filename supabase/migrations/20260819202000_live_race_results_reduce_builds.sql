create or replace function app_private.queue_site_build_from_race_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  build_reason text;
begin
  target_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if tg_op = 'INSERT' then
    build_reason := 'race meeting route created';
  elsif tg_op = 'DELETE' then
    build_reason := 'race meeting route removed';
  elsif new.venue_slug is distinct from old.venue_slug
     or new.meeting_date is distinct from old.meeting_date then
    build_reason := 'race meeting route changed';
  elsif new.status is distinct from old.status
     and new.status::text in ('completed', 'cancelled', 'abandoned') then
    build_reason := 'race meeting reached terminal status';
  else
    return new;
  end if;

  perform app_private.queue_site_content_build(
    build_reason,
    'race_meetings',
    target_id
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.queue_site_build_from_race_meeting()
from public, anon, authenticated;

drop trigger if exists queue_site_build_race_meetings on public.race_meetings;
create trigger queue_site_build_race_meetings
after insert or delete or update of status, venue_slug, meeting_date
on public.race_meetings
for each row execute function app_private.queue_site_build_from_race_meeting();

-- Individual fixture/result changes are displayed from the live public RPC in
-- the browser. Static rebuilds remain limited to route creation/removal and a
-- single terminal meeting snapshot for search engines and no-JavaScript users.
drop trigger if exists queue_site_build_fixtures on public.fixtures;
drop trigger if exists queue_site_build_race_entries on public.race_entries;

comment on function app_private.queue_site_build_from_race_meeting() is
  'Queues static builds only when a public meeting route changes or reaches a terminal status; live race results are fetched from Supabase by the public page.';
