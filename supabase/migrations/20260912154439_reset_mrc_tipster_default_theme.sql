do $$
declare
  target_count integer;
  target_tipster_id uuid;
begin
  select count(*)
  into target_count
  from public.tipsters
  where upper(btrim(display_name)) = 'MRC'
    and is_verified = true;

  if target_count <> 1 then
    raise exception 'Expected exactly one verified MrC tipster profile; found %.', target_count;
  end if;

  select id
  into target_tipster_id
  from public.tipsters
  where upper(btrim(display_name)) = 'MRC'
    and is_verified = true;

  update public.tipsters
  set
    theme_primary_color = '#FFB000',
    theme_secondary_color = '#00D4E8',
    theme_surface_color = '#351657',
    updated_at = now()
  where id = target_tipster_id;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    null,
    'tipster_theme_reset_to_default',
    'tipster',
    target_tipster_id,
    jsonb_build_object(
      'displayName', 'MrC',
      'primary', '#FFB000',
      'secondary', '#00D4E8',
      'surface', '#351657',
      'reason', 'Restore the original MRC client-facing colors while retaining GJ custom colors.'
    )
  );
end;
$$;
