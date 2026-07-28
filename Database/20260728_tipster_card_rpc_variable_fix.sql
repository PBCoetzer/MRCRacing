begin;

do $$
declare
  save_definition text;
  corrected_save_definition text;
  revise_definition text;
  corrected_revise_definition text;
begin
  select pg_get_functiondef(
    'public.save_tip_card_draft(uuid,uuid,text,text,integer,integer,public.tip_card_status,jsonb,jsonb)'::regprocedure
  )
  into save_definition;

  corrected_save_definition := replace(
    save_definition,
    E'tip_card_id,\n        v_fixture_id,\n        v_winner_entry_id,\n        v_place_entry_id,',
    E'tip_card_id,\n        fixture_id,\n        winner_entry_id,\n        place_entry_id,'
  );
  corrected_save_definition := replace(
    corrected_save_definition,
    E'card_row.id,\n        fixture_id,\n        winner_entry_id,\n        place_entry_id,',
    E'card_row.id,\n        v_fixture_id,\n        v_winner_entry_id,\n        v_place_entry_id,'
  );

  if corrected_save_definition = save_definition then
    raise exception 'save_tip_card_draft correction pattern was not found.';
  end if;

  execute corrected_save_definition;

  select pg_get_functiondef(
    'public.revise_tip_card(uuid,integer,text,jsonb,jsonb)'::regprocedure
  )
  into revise_definition;

  corrected_revise_definition := replace(
    revise_definition,
    E'tip_card_id,\n        fixture_id,\n        v_winner_entry_id,\n        v_place_entry_id,',
    E'tip_card_id,\n        fixture_id,\n        winner_entry_id,\n        place_entry_id,'
  );
  corrected_revise_definition := replace(
    corrected_revise_definition,
    E'card_row.id,\n        fixture_row.id,\n        winner_entry_id,\n        place_entry_id,',
    E'card_row.id,\n        fixture_row.id,\n        v_winner_entry_id,\n        v_place_entry_id,'
  );

  if corrected_revise_definition = revise_definition then
    raise exception 'revise_tip_card correction pattern was not found.';
  end if;

  execute corrected_revise_definition;
end;
$$;

commit;
