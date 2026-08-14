do $$
declare
  search_model_secret_id uuid;
  extraction_model_secret_id uuid;
begin
  select id
  into search_model_secret_id
  from vault.secrets
  where name = 'mrc_race_llm_search_model';

  if search_model_secret_id is null then
    perform vault.create_secret(
      'gemini-3.6-flash',
      'mrc_race_llm_search_model',
      'Gemini model used for grounded race research.',
      null
    );
  else
    perform vault.update_secret(
      search_model_secret_id,
      'gemini-3.6-flash',
      'mrc_race_llm_search_model',
      'Gemini model used for grounded race research.',
      null
    );
  end if;

  select id
  into extraction_model_secret_id
  from vault.secrets
  where name = 'mrc_race_llm_extraction_model';

  if extraction_model_secret_id is null then
    perform vault.create_secret(
      'gemini-3.6-flash',
      'mrc_race_llm_extraction_model',
      'Gemini model used for structured race extraction.',
      null
    );
  else
    perform vault.update_secret(
      extraction_model_secret_id,
      'gemini-3.6-flash',
      'mrc_race_llm_extraction_model',
      'Gemini model used for structured race extraction.',
      null
    );
  end if;
end;
$$;

;
