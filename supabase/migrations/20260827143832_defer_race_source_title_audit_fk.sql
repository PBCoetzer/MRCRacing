alter table app_private.race_source_title_audit
  alter constraint race_source_title_audit_fixture_id_fkey
  deferrable initially deferred;
