alter table public.race_entries
  drop constraint if exists race_entries_status_check;

alter table public.race_entries
  add constraint race_entries_status_check
  check (status in ('active', 'reserve', 'scratched', 'withdrawn'));

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid)
  into function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private'
    and p.proname = 'apply_race_snapshot'
  order by p.oid
  limit 1;

  if function_definition is null then
    raise exception 'app_private.apply_race_snapshot was not found.';
  end if;

  if position(
    'incoming_runner_status not in (''active'', ''scratched'', ''withdrawn'')'
    in function_definition
  ) = 0 then
    raise exception 'The ingest runner-status validation could not be updated safely.';
  end if;

  function_definition := replace(
    function_definition,
    'incoming_runner_status not in (''active'', ''scratched'', ''withdrawn'')',
    'incoming_runner_status not in (''active'', ''reserve'', ''scratched'', ''withdrawn'')'
  );

  execute function_definition;
end;
$$;;
