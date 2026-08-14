begin;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  phone text,
  roles public.app_role[],
  wallet_balance integer,
  tipster_id uuid,
  tipster_display_name text,
  tipster_verified boolean,
  test_access boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.display_name,
    p.phone,
    coalesce(
      array_agg(ur.role order by ur.role) filter (where ur.role is not null),
      '{}'::public.app_role[]
    ),
    coalesce(w.balance, 0),
    t.id,
    t.display_name,
    coalesce(t.is_verified, false),
    ta.user_id is not null,
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_roles ur on ur.user_id = u.id
  left join public.wallets w on w.user_id = u.id
  left join public.tipsters t on t.user_id = u.id
  left join public.test_access_users ta on ta.user_id = u.id
  group by
    u.id,
    u.email,
    p.display_name,
    p.phone,
    w.balance,
    t.id,
    t.display_name,
    t.is_verified,
    ta.user_id,
    u.created_at
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_configure_user(
  p_user_id uuid,
  p_client boolean,
  p_tipster boolean,
  p_administrator boolean,
  p_tipster_display_name text default null,
  p_tipster_biography text default null,
  p_verify_tipster boolean default false,
  p_test_access boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  tipster_row public.tipsters%rowtype;
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.';
  end if;

  if p_user_id = current_user_id and not p_administrator then
    raise exception 'You cannot remove your own administrator role.';
  end if;

  if not p_client and not p_tipster and not p_administrator then
    raise exception 'At least one role is required.';
  end if;

  if p_client then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'client')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'client';
  end if;

  if p_tipster then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'tipster')
    on conflict (user_id, role) do nothing;

    insert into public.tipsters (
      user_id,
      display_name,
      biography,
      is_verified
    )
    values (
      p_user_id,
      coalesce(
        nullif(btrim(coalesce(p_tipster_display_name, '')), ''),
        (select nullif(btrim(coalesce(display_name, '')), '') from public.profiles where id = p_user_id),
        'MRC Tipster'
      ),
      nullif(btrim(coalesce(p_tipster_biography, '')), ''),
      p_verify_tipster
    )
    on conflict (user_id) do update
    set
      display_name = excluded.display_name,
      biography = excluded.biography,
      is_verified = excluded.is_verified
    returning * into tipster_row;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'tipster';

    update public.tipsters
    set is_verified = false
    where user_id = p_user_id
    returning * into tipster_row;
  end if;

  if p_administrator then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'administrator')
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'administrator';
  end if;

  if p_test_access then
    insert into public.test_access_users (user_id, granted_by)
    values (p_user_id, current_user_id)
    on conflict (user_id) do update
    set granted_by = excluded.granted_by;
  else
    delete from public.test_access_users
    where user_id = p_user_id;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'user_access_configured',
    'profile',
    p_user_id,
    jsonb_build_object(
      'client', p_client,
      'tipster', p_tipster,
      'administrator', p_administrator,
      'tipsterVerified', p_verify_tipster,
      'testAccess', p_test_access
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'client', p_client,
    'tipster', p_tipster,
    'administrator', p_administrator,
    'tipsterId', tipster_row.id,
    'tipsterVerified', coalesce(tipster_row.is_verified, false),
    'testAccess', p_test_access
  );
end;
$$;

create or replace function public.admin_adjust_wallet(
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_balance integer;
  new_balance integer;
  transaction_id uuid := gen_random_uuid();
begin
  if not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Wallet adjustment must be non-zero.';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason of at least five characters is required.';
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance
  into current_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  new_balance := current_balance + p_amount;

  if new_balance < 0 then
    raise exception 'Wallet balance cannot become negative.';
  end if;

  update public.wallets
  set balance = new_balance
  where user_id = p_user_id;

  insert into public.credit_transactions (
    id,
    user_id,
    transaction_type,
    amount,
    balance_after,
    reason,
    idempotency_key,
    created_by
  )
  values (
    transaction_id,
    p_user_id,
    case when p_amount > 0 then 'admin_add' else 'admin_remove' end,
    p_amount,
    new_balance,
    btrim(p_reason),
    'admin-wallet:' || transaction_id::text,
    current_user_id
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'wallet_adjusted',
    'wallet',
    p_user_id,
    jsonb_build_object(
      'amount', p_amount,
      'balanceBefore', current_balance,
      'balanceAfter', new_balance,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'amount', p_amount,
    'balance', new_balance,
    'transactionId', transaction_id
  );
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_configure_user(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean
) from public;
revoke all on function public.admin_adjust_wallet(uuid, integer, text) from public;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_configure_user(
  uuid, boolean, boolean, boolean, text, text, boolean, boolean
) to authenticated;
grant execute on function public.admin_adjust_wallet(uuid, integer, text) to authenticated;

commit;;
