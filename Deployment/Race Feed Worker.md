# Race Feed Worker

The race worker uses a staged Gemini workflow and never writes model output directly
to race tables.

1. A weekly grounded search discovers South African meetings only.
2. One grounded search per meeting captures the race schedule.
3. One grounded search per race captures runners and factual race details.
4. Complete meeting fragments become a proposal with citations, deterministic
   confidence scoring, source agreement, and a current-database diff.
5. Proposals below the auto-approval threshold open an audited administrator review.
   Telegram attaches a branded, paginated MRC approval PDF containing every race,
   runner, jockey, trainer, draw, carried weight, and status. A concise caption and
   the review buttons remain on the document message.
6. Approved proposals use the existing atomic ingestion RPC, preserving locks and
   creating tip-impact alerts only after factual changes are applied.

Odds, dividends, payouts, Lucky Pick, Quick Pick, bookmaker markets, and betting
controls are rejected by validation and are not stored by this workflow.

## Required Supabase Configuration

The Edge Function reads server-only values from Supabase secrets or the service-only
Vault configuration RPC:

```text
RACE_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
RACE_LLM_API_KEY=server-only-key
RACE_LLM_SEARCH_MODEL=gemini-3.6-flash
RACE_LLM_EXTRACTION_MODEL=gemini-3.6-flash
RACE_LLM_RESPONSE_MODE=json_schema
```

Never add these values to Xneelo, browser code, or a `NEXT_PUBLIC_` variable.

## Deployment

1. Apply `Database/20260811_mrc_llm_race_feed.sql`.
2. Apply `Database/20260811_mrc_llm_vault_configuration.sql`.
3. Apply `Database/20260811_mrc_gemini_grounded_race_feed.sql`.
4. Apply `Database/20260811_mrc_gemini_current_models.sql`.
5. Deploy `supabase/functions/sync-race-data` with gateway JWT verification disabled.
   The function performs its own rotating worker-token or administrator-JWT check.
6. Keep the existing Cron schedule at `2-59/5 * * * *`.
7. Review tasks, fragments, proposals, citations, source trust, and settings from
   `/admin/racing/`.

## Scheduling and Limits

- The worker claims at most one task per invocation.
- Weekly discovery contains meeting dates and venues only.
- Meeting schedules and individual races are researched separately to avoid oversized
  prompts and responses.
- Failed tasks retry on a later five-minute execution rather than holding the Edge
  Function open.
- Google Search and structured extraction have separate bounded timeouts.
- Result polling is created only for non-test meetings linked to non-void tip cards.
- Formgrids is the sole authoritative publishing source. Ordinary Hermes meeting,
  race-detail, and result tasks are restricted to `formgrids.info`.
- Complete, conflict-free Formgrids meeting snapshots may auto-apply at 90% Hermes
  confidence. Existing exact-confidence result handling remains available for
  Formgrids-backed results.
- Raceform and Tote are comparison-only evidence sources. They cannot publish or
  auto-apply race data under any confidence score.
- If at least two independent comparison domains report the same normalized difference
  within 30 minutes, administrators receive a Telegram and in-app review alert. The
  alert never changes the Formgrids-backed race record.
- New meetings, routine changes, and results remain enabled for Formgrids-driven
  auto-approval. Administrators review and correct disputed data manually.
- The daily paid-search budget applies only to provider-backed searches. Tasks marked
  `delegate_to_hermes` continue through the local Hermes worker after that budget is
  exhausted, so race discovery and schedule updates do not stop.
- Dummy meetings must remain until one future meeting and one recent results meeting
  pass the full proposal and approval acceptance test.

## Google Quota Gate

The configured API key can list Gemini models, but the current Google project returns
HTTP 429 for grounded generation. Enable Gemini API quota or replace the provider before
the acceptance test and dummy-data cleanup. The website and existing race data continue
working while the task remains in a retryable failed state.

## Linux Cutover

The staged task, validation, proposal, approval, and ingestion workflow remains in
Supabase. A future authenticated Linux service can replace model execution while keeping
the same normalized extraction contract. Do not expose Ollama, vLLM, SSH, or an
unrestricted model endpoint directly.
