-- Reward-only purchases grant promotional access but must not create ECHCU ledger rows.
create or replace function app_private.record_charity_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  coin_rate numeric(12, 4);
  contribution_cents integer;
begin
  select zar_per_coin into coin_rate
  from public.platform_settings
  where singleton = true;

  coin_rate := coalesce(coin_rate, 1.0000);
  contribution_cents := round(
    new.platform_fee_coins * coin_rate * 100 * 1000 / 10000.0
  )::integer;

  if tg_op = 'INSERT'
    and new.status <> 'refunded'
    and new.platform_fee_coins > 0
  then
    insert into public.charity_contribution_entries (
      purchase_id,
      entry_type,
      basis_platform_fee_coins,
      zar_per_coin,
      contribution_rate_bps,
      amount_cents,
      reason
    ) values (
      new.id,
      'accrual',
      new.platform_fee_coins,
      coin_rate,
      1000,
      contribution_cents,
      '10% of MRC platform commission'
    ) on conflict (purchase_id, entry_type) do nothing;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'refunded'
    and new.platform_fee_coins > 0
  then
    insert into public.charity_contribution_entries (
      purchase_id,
      entry_type,
      basis_platform_fee_coins,
      zar_per_coin,
      contribution_rate_bps,
      amount_cents,
      reason
    ) values (
      new.id,
      'reversal',
      -new.platform_fee_coins,
      coin_rate,
      1000,
      -contribution_cents,
      'Contribution reversal for refunded purchase'
    ) on conflict (purchase_id, entry_type) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function app_private.record_charity_contribution()
from public, anon, authenticated;
