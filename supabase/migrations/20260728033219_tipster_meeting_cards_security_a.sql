drop trigger if exists set_platform_settings_updated_at on public.platform_settings;
create trigger set_platform_settings_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_race_meetings_updated_at on public.race_meetings;
create trigger set_race_meetings_updated_at
before update on public.race_meetings
for each row execute function public.set_updated_at();

drop trigger if exists set_race_entries_updated_at on public.race_entries;
create trigger set_race_entries_updated_at
before update on public.race_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_meeting_bet_options_updated_at on public.meeting_bet_options;
create trigger set_meeting_bet_options_updated_at
before update on public.meeting_bet_options
for each row execute function public.set_updated_at();

drop trigger if exists set_tip_cards_updated_at on public.tip_cards;
create trigger set_tip_cards_updated_at
before update on public.tip_cards
for each row execute function public.set_updated_at();

drop trigger if exists set_race_tip_selections_updated_at on public.race_tip_selections;
create trigger set_race_tip_selections_updated_at
before update on public.race_tip_selections
for each row execute function public.set_updated_at();

drop trigger if exists set_tip_card_multiples_updated_at on public.tip_card_multiples;
create trigger set_tip_card_multiples_updated_at
before update on public.tip_card_multiples
for each row execute function public.set_updated_at();

drop trigger if exists set_tipster_packages_updated_at on public.tipster_packages;
create trigger set_tipster_packages_updated_at
before update on public.tipster_packages
for each row execute function public.set_updated_at();

drop trigger if exists set_notification_outbox_updated_at on public.notification_outbox;
create trigger set_notification_outbox_updated_at
before update on public.notification_outbox
for each row execute function public.set_updated_at();

create index if not exists race_meetings_starts_idx
on public.race_meetings (first_race_at, status);

create index if not exists fixtures_meeting_starts_idx
on public.fixtures (meeting_id, starts_at);

create index if not exists race_entries_fixture_idx
on public.race_entries (fixture_id, saddle_number);

create index if not exists meeting_bet_options_meeting_idx
on public.meeting_bet_options (meeting_id, cutoff_at);

create index if not exists tip_cards_tipster_status_idx
on public.tip_cards (tipster_id, status, updated_at desc);

create index if not exists tip_cards_meeting_status_idx
on public.tip_cards (meeting_id, status);

create index if not exists content_purchases_user_created_idx
on public.content_purchases (user_id, created_at desc);

create index if not exists content_purchases_tipster_created_idx
on public.content_purchases (tipster_id, created_at desc);

create index if not exists tipster_subscriptions_user_active_idx
on public.tipster_subscriptions (user_id, tipster_id, ends_at)
where status = 'active';

create index if not exists tip_card_entitlements_user_idx
on public.tip_card_entitlements (user_id, tip_card_id)
where revoked_at is null;

create index if not exists tipster_earnings_tipster_created_idx
on public.tipster_earnings (tipster_id, created_at desc);

create index if not exists purchase_disputes_status_created_idx
on public.purchase_disputes (status, created_at);

create index if not exists notification_outbox_delivery_idx
on public.notification_outbox (status, available_at)
where status in ('pending', 'failed');

alter table public.platform_settings enable row level security;
alter table public.test_access_users enable row level security;
alter table public.race_meetings enable row level security;
alter table public.race_entries enable row level security;
alter table public.meeting_bet_options enable row level security;
alter table public.meeting_bet_legs enable row level security;
alter table public.tip_cards enable row level security;
alter table public.race_tip_selections enable row level security;
alter table public.tip_card_multiples enable row level security;
alter table public.tip_card_multiple_selections enable row level security;
alter table public.tip_card_revisions enable row level security;
alter table public.tipster_packages enable row level security;
alter table public.content_purchases enable row level security;
alter table public.tipster_subscriptions enable row level security;
alter table public.tip_card_entitlements enable row level security;
alter table public.tipster_earnings enable row level security;
alter table public.purchase_disputes enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists "fixtures_public_read" on public.fixtures;
create policy "fixtures_public_read"
on public.fixtures for select
to anon, authenticated
using (
  meeting_id is null
  or app_private.can_view_meeting(meeting_id)
);

drop policy if exists "platform_settings_authenticated_read" on public.platform_settings;
create policy "platform_settings_authenticated_read"
on public.platform_settings for select
to authenticated
using (true);

drop policy if exists "platform_settings_admin_all" on public.platform_settings;
create policy "platform_settings_admin_all"
on public.platform_settings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "test_access_users_select_own_or_admin" on public.test_access_users;
create policy "test_access_users_select_own_or_admin"
on public.test_access_users for select
to authenticated
using (
  user_id = (select auth.uid())
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "test_access_users_admin_all" on public.test_access_users;
create policy "test_access_users_admin_all"
on public.test_access_users for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_meetings_visible_read" on public.race_meetings;
create policy "race_meetings_visible_read"
on public.race_meetings for select
to anon, authenticated
using (
  is_test = false
  or app_private.user_has_test_access((select auth.uid()))
);

drop policy if exists "race_meetings_admin_all" on public.race_meetings;
create policy "race_meetings_admin_all"
on public.race_meetings for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_entries_visible_read" on public.race_entries;
create policy "race_entries_visible_read"
on public.race_entries for select
to anon, authenticated
using (
  exists (
    select 1
    from public.fixtures f
    where f.id = race_entries.fixture_id
      and app_private.can_view_meeting(f.meeting_id)
  )
);

drop policy if exists "race_entries_admin_all" on public.race_entries;
create policy "race_entries_admin_all"
on public.race_entries for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "meeting_bet_options_visible_read" on public.meeting_bet_options;
create policy "meeting_bet_options_visible_read"
on public.meeting_bet_options for select
to anon, authenticated
using (app_private.can_view_meeting(meeting_id));

drop policy if exists "meeting_bet_options_admin_all" on public.meeting_bet_options;
create policy "meeting_bet_options_admin_all"
on public.meeting_bet_options for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "meeting_bet_legs_visible_read" on public.meeting_bet_legs;
create policy "meeting_bet_legs_visible_read"
on public.meeting_bet_legs for select
to anon, authenticated
using (
  exists (
    select 1
    from public.meeting_bet_options o
    where o.id = meeting_bet_legs.bet_option_id
      and app_private.can_view_meeting(o.meeting_id)
  )
);

drop policy if exists "meeting_bet_legs_admin_all" on public.meeting_bet_legs;
create policy "meeting_bet_legs_admin_all"
on public.meeting_bet_legs for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "tip_cards_marketplace_read" on public.tip_cards;
create policy "tip_cards_marketplace_read"
on public.tip_cards for select
to anon, authenticated
using (
  status in ('coming_soon', 'published')
  and app_private.can_view_meeting(meeting_id)
);

drop policy if exists "tip_cards_owner_read" on public.tip_cards;
create policy "tip_cards_owner_read"
on public.tip_cards for select
to authenticated
using (
  exists (
    select 1
    from public.tipsters t
    where t.id = tip_cards.tipster_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "tip_cards_admin_all" on public.tip_cards;
create policy "tip_cards_admin_all"
on public.tip_cards for all
to authenticated
using (app_private.current_user_has_role('administrator'))
with check (app_private.current_user_has_role('administrator'));

drop policy if exists "race_tip_selections_entitled_read" on public.race_tip_selections;
create policy "race_tip_selections_entitled_read"
on public.race_tip_selections for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = race_tip_selections.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tip_card_multiples_entitled_read" on public.tip_card_multiples;
create policy "tip_card_multiples_entitled_read"
on public.tip_card_multiples for select
to authenticated
using (
  app_private.user_can_access_tip_card(tip_card_id, (select auth.uid()))
  or exists (
    select 1
    from public.tip_cards c
    join public.tipsters t on t.id = c.tipster_id
    where c.id = tip_card_multiples.tip_card_id
      and t.user_id = (select auth.uid())
  )
  or app_private.current_user_has_role('administrator')
);

drop policy if exists "tip_card_multiple_selections_entitled_read" on public.tip_card_multiple_selections;
create policy "tip_card_multiple_selections_entitled_read"
on public.tip_card_multiple_selections for select
to authenticated
using (
  exists (
    select 1
    from public.tip_card_multiples m
    where m.id = tip_card_multiple_selections.multiple_id
      and (
        app_private.user_can_access_tip_card(m.tip_card_id, (select auth.uid()))
        or exists (
          select 1
          from public.tip_cards c
          join public.tipsters t on t.id = c.tipster_id
          where c.id = m.tip_card_id
            and t.user_id = (select auth.uid())
        )
        or app_private.current_user_has_role('administrator')
      )
  )
);

;
