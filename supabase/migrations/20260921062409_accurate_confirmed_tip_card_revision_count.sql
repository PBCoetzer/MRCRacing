alter table public.tip_cards
add column if not exists confirmed_revision_count integer;

alter table public.tip_cards disable trigger set_tip_cards_updated_at;

update public.tip_cards cards
set confirmed_revision_count = (
  select count(*)::integer
  from public.tip_card_revisions revisions
  where revisions.tip_card_id = cards.id
);

alter table public.tip_cards enable trigger set_tip_cards_updated_at;

alter table public.tip_cards
alter column confirmed_revision_count set default 0,
alter column confirmed_revision_count set not null;

alter table public.tip_cards
drop constraint if exists tip_cards_confirmed_revision_count_check;

alter table public.tip_cards
add constraint tip_cards_confirmed_revision_count_check
check (confirmed_revision_count >= 0);

comment on column public.tip_cards.confirmed_revision_count is
  'Number of immutable publication and correction records confirmed by the Tipster. Draft saves are excluded.';

create or replace function app_private.sync_tip_card_confirmed_revision_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tip_card_id uuid;
begin
  if tg_op = 'DELETE' then
    target_tip_card_id := old.tip_card_id;
  else
    target_tip_card_id := new.tip_card_id;
  end if;

  update public.tip_cards cards
  set confirmed_revision_count = (
    select count(*)::integer
    from public.tip_card_revisions revisions
    where revisions.tip_card_id = target_tip_card_id
  )
  where cards.id = target_tip_card_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function app_private.sync_tip_card_confirmed_revision_count()
from public, anon, authenticated, service_role;

drop trigger if exists sync_tip_card_confirmed_revision_count
on public.tip_card_revisions;

create trigger sync_tip_card_confirmed_revision_count
after insert or delete on public.tip_card_revisions
for each row
execute function app_private.sync_tip_card_confirmed_revision_count();

comment on function app_private.sync_tip_card_confirmed_revision_count() is
  'Keeps the displayed confirmed revision count aligned with immutable Tipster publication and correction history.';
