create index if not exists hermes_race_jobs_proposal_idx
  on app_private.hermes_race_jobs (proposal_id)
  where proposal_id is not null;

create index if not exists hermes_race_jobs_source_run_idx
  on app_private.hermes_race_jobs (source_run_id)
  where source_run_id is not null;
