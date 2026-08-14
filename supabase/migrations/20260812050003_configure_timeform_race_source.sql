insert into public.race_source_domains (
  domain,
  display_name,
  status,
  reliability_score,
  reuse_basis,
  direct_fetch_allowed,
  can_auto_approve,
  last_reviewed_at
)
values (
  'timeformracing.com',
  'Timeform Racing',
  'evidence_only',
  70,
  'Public factual racecard evidence; manual proposal approval remains required.',
  true,
  false,
  now()
)
on conflict (domain) do update
set
  display_name = excluded.display_name,
  status = excluded.status,
  reliability_score = excluded.reliability_score,
  reuse_basis = excluded.reuse_basis,
  direct_fetch_allowed = excluded.direct_fetch_allowed,
  can_auto_approve = excluded.can_auto_approve,
  last_reviewed_at = excluded.last_reviewed_at,
  updated_at = now();;
