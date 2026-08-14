create or replace function public.publish_tip_card(
  p_card_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  meeting_row public.race_meetings%rowtype;
begin
  select *
  into card_row
  from public.tip_cards
  where id = p_card_id
  for update;

  if current_tipster_id is null
    or card_row.id is null
    or card_row.tipster_id <> current_tipster_id
  then
    raise exception 'Tip card not found.';
  end if;

  if card_row.status not in ('draft', 'coming_soon') then
    raise exception 'This tip card is already published or closed.';
  end if;

  if card_row.revision <> p_expected_revision then
    raise exception 'Tip card changed in another session. Reload before publishing.';
  end if;

  select *
  into meeting_row
  from public.race_meetings
  where id = card_row.meeting_id;

  if meeting_row.status <> 'scheduled' or meeting_row.first_race_at <= now() then
    raise exception 'The first publication must happen before Race 1 starts.';
  end if;

  if not exists (
    select 1
    from public.tip_card_multiples m
    where m.tip_card_id = card_row.id
      and app_private.multiple_is_complete(m.id)
  ) then
    raise exception 'Complete at least one PA, Pick 6, Bipot, Jackpot, or Other meeting bet before publishing.';
  end if;

  update public.tip_cards
  set
    status = 'published',
    revision = revision + 1,
    published_at = now(),
    listed_at = coalesce(listed_at, now())
  where id = card_row.id
  returning * into card_row;

  insert into public.tip_card_revisions (
    tip_card_id,
    revision,
    revision_type,
    actor_id,
    summary,
    snapshot
  )
  values (
    card_row.id,
    card_row.revision,
    'publication',
    (select auth.uid()),
    'Initial meeting card publication',
    app_private.tip_card_snapshot(card_row.id)
  );

  perform app_private.queue_tip_card_notifications(
    card_row.id,
    card_row.revision,
    'tip_card_published'
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    (select auth.uid()),
    'tip_card_published',
    'tip_card',
    card_row.id,
    jsonb_build_object('revision', card_row.revision)
  );

  return to_jsonb(card_row);
end;
$$;

;
