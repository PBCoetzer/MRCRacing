begin;
select plan(3);

select has_column(
  'public',
  'tip_cards',
  'confirmed_revision_count',
  'Tip cards expose a dedicated confirmed revision count'
);

select is(
  (
    select count(*)::bigint
    from public.tip_cards cards
    where cards.confirmed_revision_count <> (
      select count(*)::integer
      from public.tip_card_revisions revisions
      where revisions.tip_card_id = cards.id
    )
  ),
  0::bigint,
  'Every confirmed revision count matches immutable revision history'
);

select is(
  (
    select count(*)::bigint
    from pg_trigger triggers
    join pg_class relations on relations.oid = triggers.tgrelid
    join pg_namespace schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'public'
      and relations.relname = 'tip_card_revisions'
      and triggers.tgname = 'sync_tip_card_confirmed_revision_count'
      and triggers.tgenabled = 'O'
      and not triggers.tgisinternal
  ),
  1::bigint,
  'Confirmed revision history keeps its displayed count synchronized'
);

select * from finish();
rollback;
