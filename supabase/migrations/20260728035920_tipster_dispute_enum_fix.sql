begin;

do $$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'public.resolve_purchase_dispute(uuid,boolean,text)'::regprocedure
  )
  into function_definition;

  corrected_definition := replace(
    function_definition,
    E'status = case when p_approve_refund then ''approved'' else ''rejected'' end,',
    E'status = case\n      when p_approve_refund then ''approved''::public.purchase_dispute_status\n      else ''rejected''::public.purchase_dispute_status\n    end,'
  );

  if corrected_definition = function_definition then
    raise exception 'resolve_purchase_dispute correction pattern was not found.';
  end if;

  execute corrected_definition;
end;
$$;

commit;;
