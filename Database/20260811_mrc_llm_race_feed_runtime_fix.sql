do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'app_private.apply_race_snapshot(uuid,uuid,jsonb,boolean)'::regprocedure
  )
  into function_definition;

  if position('snapshot_apply.meetings_seen' in function_definition) > 0
    and position('<<snapshot_apply>>' in function_definition) = 0
  then
    function_definition := replace(
      function_definition,
      E'AS $function$\nDECLARE',
      E'AS $function$\n<<snapshot_apply>>\nDECLARE'
    );
    function_definition := replace(
      function_definition,
      E'AS $function$\ndeclare',
      E'AS $function$\n<<snapshot_apply>>\ndeclare'
    );
  end if;

  if position('apply_race_snapshot.meetings_seen' in function_definition) > 0 then
    function_definition := replace(
      function_definition,
      'apply_race_snapshot.meetings_seen',
      'snapshot_apply.meetings_seen'
    );
    function_definition := replace(
      function_definition,
      'apply_race_snapshot.races_seen',
      'snapshot_apply.races_seen'
    );
    function_definition := replace(
      function_definition,
      'apply_race_snapshot.entries_seen',
      'snapshot_apply.entries_seen'
    );
    function_definition := replace(
      function_definition,
      'apply_race_snapshot.changes_applied',
      'snapshot_apply.changes_applied'
    );
    function_definition := replace(
      function_definition,
      'apply_race_snapshot.alerts_created',
      'snapshot_apply.alerts_created'
    );
  end if;

  execute function_definition;
end;
$$;
