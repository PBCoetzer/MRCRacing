create or replace function public.get_race_llm_configuration()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  configuration jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service-role access required.';
  end if;

  select jsonb_build_object(
    'baseUrl', max(decrypted_secret) filter (where name = 'mrc_race_llm_base_url'),
    'apiKey', max(decrypted_secret) filter (where name = 'mrc_race_llm_api_key'),
    'model', max(decrypted_secret) filter (where name = 'mrc_race_llm_model'),
    'responseMode', max(decrypted_secret) filter (where name = 'mrc_race_llm_response_mode')
  )
  into configuration
  from vault.decrypted_secrets
  where name in (
    'mrc_race_llm_base_url',
    'mrc_race_llm_api_key',
    'mrc_race_llm_model',
    'mrc_race_llm_response_mode'
  );

  return coalesce(configuration, '{}'::jsonb);
end;
$$;

revoke all on function public.get_race_llm_configuration() from public, anon, authenticated;
grant execute on function public.get_race_llm_configuration() to service_role;
