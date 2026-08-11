create index if not exists race_feed_sources_created_by_idx
on public.race_feed_sources (created_by)
where created_by is not null;

create index if not exists race_feed_runs_reviewed_by_idx
on public.race_feed_runs (reviewed_by)
where reviewed_by is not null;

create index if not exists race_change_events_run_idx
on public.race_change_events (run_id);

create index if not exists race_change_events_source_idx
on public.race_change_events (source_id);

create index if not exists race_change_events_entry_idx
on public.race_change_events (entry_id)
where entry_id is not null;

create index if not exists tip_card_change_alerts_fixture_idx
on public.tip_card_change_alerts (fixture_id)
where fixture_id is not null;

create index if not exists tip_card_change_alerts_entry_idx
on public.tip_card_change_alerts (entry_id)
where entry_id is not null;

create index if not exists tip_card_change_alerts_acknowledged_by_idx
on public.tip_card_change_alerts (acknowledged_by)
where acknowledged_by is not null;

drop policy if exists tip_card_change_alerts_admin_read on public.tip_card_change_alerts;
drop policy if exists tip_card_change_alerts_owner_read on public.tip_card_change_alerts;
drop policy if exists tip_card_change_alerts_authorized_read on public.tip_card_change_alerts;

create policy tip_card_change_alerts_authorized_read
on public.tip_card_change_alerts
for select
to authenticated
using (
  app_private.current_user_has_role('administrator')
  or exists (
      select 1
      from public.tip_cards c
      where c.id = tip_card_change_alerts.tip_card_id
        and c.tipster_id = app_private.current_tipster_id()
    )
);
