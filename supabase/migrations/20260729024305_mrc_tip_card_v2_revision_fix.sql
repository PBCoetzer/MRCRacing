create or replace function public.revise_tip_card_v2(
  p_card_id uuid,
  p_expected_revision integer,
  p_revision_summary text,
  p_race_changes jsonb default '[]'::jsonb,
  p_multiple_changes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tipster_id uuid := app_private.current_tipster_id();
  card_row public.tip_cards%rowtype;
  multiple_item jsonb;
  target_bet_option_id uuid;
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

  for multiple_item in
    select value
    from jsonb_array_elements(coalesce(p_multiple_changes, '[]'::jsonb))
  loop
    if coalesce((multiple_item ->> 'remove')::boolean, false) then
      continue;
    end if;

    target_bet_option_id := (multiple_item ->> 'betOptionId')::uuid;

    if not exists (
      select 1
      from public.meeting_bet_options
      where id = target_bet_option_id
        and meeting_id = card_row.meeting_id
    ) then
      raise exception 'Meeting bet correction is invalid.';
    end if;

    insert into public.tip_card_multiples (
      tip_card_id,
      bet_option_id,
      tip_text
    )
    values (
      card_row.id,
      target_bet_option_id,
      nullif(btrim(coalesce(multiple_item ->> 'tipText', '')), '')
    )
    on conflict (tip_card_id, bet_option_id) do update
    set tip_text = excluded.tip_text;
  end loop;

  return public.revise_tip_card(
    p_card_id,
    p_expected_revision,
    p_revision_summary,
    p_race_changes,
    p_multiple_changes
  );
end;
$$;

revoke all on function public.revise_tip_card_v2(
  uuid,
  integer,
  text,
  jsonb,
  jsonb
) from public, anon;

grant execute on function public.revise_tip_card_v2(
  uuid,
  integer,
  text,
  jsonb,
  jsonb
) to authenticated;

;
