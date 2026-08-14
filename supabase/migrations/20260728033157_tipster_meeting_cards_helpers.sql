create or replace function app_private.current_tipster_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.tipsters
  where user_id = (select auth.uid())
    and is_verified = true
  limit 1;
$$;

create or replace function app_private.user_has_test_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.current_user_has_role('administrator')
    or app_private.current_user_has_role('tipster')
    or exists (
      select 1
      from public.test_access_users
      where user_id = target_user_id
    );
$$;

create or replace function app_private.can_view_meeting(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.race_meetings
    where id = target_meeting_id
      and (
        is_test = false
        or app_private.user_has_test_access((select auth.uid()))
      )
  );
$$;

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
  select exists (
    select 1
    from public.tip_card_entitlements e
    join public.tip_cards c on c.id = e.tip_card_id
    where e.tip_card_id = target_tip_card_id
      and e.user_id = target_user_id
      and e.revoked_at is null
      and c.status = 'published'
  );
$$;

create or replace function app_private.tip_card_snapshot(target_tip_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', to_jsonb(c),
    'raceSelections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fixtureId', r.fixture_id,
          'winnerEntryId', r.winner_entry_id,
          'placeEntryId', r.place_entry_id,
          'comments', r.comments
        )
        order by f.race_number
      )
      from public.race_tip_selections r
      join public.fixtures f on f.id = r.fixture_id
      where r.tip_card_id = c.id
    ), '[]'::jsonb),
    'multiples', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'betOptionId', m.bet_option_id,
          'customName', m.custom_name,
          'comments', m.comments,
          'selections', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'legNumber', s.leg_number,
                'fixtureId', s.fixture_id,
                'entryId', s.entry_id
              )
              order by s.leg_number, e.saddle_number
            )
            from public.tip_card_multiple_selections s
            join public.race_entries e on e.id = s.entry_id
            where s.multiple_id = m.id
          ), '[]'::jsonb)
        )
        order by o.sort_order, o.display_name
      )
      from public.tip_card_multiples m
      join public.meeting_bet_options o on o.id = m.bet_option_id
      where m.tip_card_id = c.id
    ), '[]'::jsonb)
  )
  from public.tip_cards c
  where c.id = target_tip_card_id;
$$;

create or replace function app_private.multiple_is_complete(target_multiple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with multiple_data as (
    select m.id, o.bet_type, o.leg_count
    from public.tip_card_multiples m
    join public.meeting_bet_options o on o.id = m.bet_option_id
    where m.id = target_multiple_id
  ),
  selected as (
    select
      count(distinct s.leg_number)::integer as selected_legs,
      bool_and(s.entry_id is not null) as all_have_entries
    from public.tip_card_multiple_selections s
    where s.multiple_id = target_multiple_id
  )
  select case
    when d.bet_type = 'other'
      then coalesce(s.selected_legs, 0) >= 2 and coalesce(s.all_have_entries, false)
    else
      coalesce(s.selected_legs, 0) = d.leg_count
      and d.leg_count > 0
      and coalesce(s.all_have_entries, false)
  end
  from multiple_data d
  cross join selected s;
$$;

create or replace function app_private.enqueue_notification(
  target_user_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_id uuid;
  was_inserted boolean := false;
begin
  insert into public.notification_outbox (
    user_id,
    event_type,
    dedupe_key,
    payload
  )
  values (
    target_user_id,
    target_event_type,
    target_dedupe_key,
    target_payload
  )
  on conflict (dedupe_key) do nothing
  returning id into outbox_id;

  was_inserted := outbox_id is not null;

  if not was_inserted then
    select id
    into outbox_id
    from public.notification_outbox
    where dedupe_key = target_dedupe_key;
  else
    perform pgmq.send(
      'tip_notifications',
      jsonb_build_object('outboxId', outbox_id)
    );
  end if;

  return outbox_id;
end;
$$;

create or replace function app_private.queue_tip_card_notifications(
  target_tip_card_id uuid,
  target_revision integer,
  target_event_type text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
  recipient record;
  recipient_count integer := 0;
  event_title text;
  event_body text;
begin
  select
    c.id,
    c.tipster_id,
    c.title,
    c.revision,
    c.meeting_id,
    t.display_name as tipster_name,
    m.venue,
    m.meeting_date,
    m.first_race_at
  into card_row
  from public.tip_cards c
  join public.tipsters t on t.id = c.tipster_id
  join public.race_meetings m on m.id = c.meeting_id
  where c.id = target_tip_card_id;

  insert into public.tip_card_entitlements (
    user_id,
    tip_card_id,
    source_type,
    source_purchase_id,
    source_subscription_id
  )
  select
    s.user_id,
    card_row.id,
    'subscription',
    s.purchase_id,
    s.id
  from public.tipster_subscriptions s
  where s.tipster_id = card_row.tipster_id
    and s.status = 'active'
    and card_row.first_race_at >= s.starts_at
    and card_row.first_race_at < s.ends_at
  on conflict do nothing;

  event_title := case
    when target_event_type = 'tip_card_corrected'
      then 'Tip card correction published'
    else 'Your meeting tips are ready'
  end;

  event_body := case
    when target_event_type = 'tip_card_corrected'
      then card_row.tipster_name || ' updated the ' || card_row.venue || ' meeting card.'
    else card_row.tipster_name || ' published tips for ' || card_row.venue || '.'
  end;

  for recipient in
    select distinct e.user_id
    from public.tip_card_entitlements e
    join public.profiles p on p.id = e.user_id
    where e.tip_card_id = card_row.id
      and e.revoked_at is null
      and p.email_notifications_enabled = true
  loop
    insert into public.notifications (user_id, title, body)
    values (recipient.user_id, event_title, event_body);

    perform app_private.enqueue_notification(
      recipient.user_id,
      target_event_type,
      'tip-card:' || card_row.id::text ||
        ':revision:' || target_revision::text ||
        ':user:' || recipient.user_id::text ||
        ':email',
      jsonb_build_object(
        'template', target_event_type,
        'tipCardId', card_row.id,
        'revision', target_revision,
        'tipsterName', card_row.tipster_name,
        'meetingVenue', card_row.venue,
        'meetingDate', card_row.meeting_date,
        'cardTitle', card_row.title,
        'clientUrl', 'https://www.mrcracing.co.za/client/?card=' || card_row.id::text
      )
    );

    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

create or replace function app_private.validate_entry_for_fixture(
  target_entry_id uuid,
  target_fixture_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_entry_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.race_entries
    where id = target_entry_id
      and fixture_id = target_fixture_id
      and status = 'active'
  ) then
    raise exception 'Selected runner does not belong to this race or is scratched.';
  end if;
end;
$$;

;
