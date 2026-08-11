# Race Feed Worker

The race worker checks approved public pages, skips unchanged content, extracts factual
race data with an OpenAI-compatible LLM, and writes validated snapshots to Supabase.

## Required Supabase Secrets

```text
RACE_LLM_BASE_URL=https://provider.example/v1
RACE_LLM_API_KEY=server-only-key
RACE_LLM_MODEL=structured-extraction-model
RACE_LLM_RESPONSE_MODE=json_schema
```

`RACE_LLM_BASE_URL` may be changed later to the authenticated public Linux endpoint.
Never add these values to the Xneelo frontend or a `NEXT_PUBLIC_` variable.

## Deployment

1. Apply `Database/20260811_mrc_llm_race_feed.sql`.
2. Deploy `supabase/functions/sync-race-data` with gateway JWT verification disabled;
   the function performs its own rotating worker-token or administrator-JWT check.
3. Configure the Cron token and job once:

```sql
select app_private.configure_race_feed_cron(
  'https://PROJECT_REF.supabase.co'
);
```

4. Add approved HTTPS source pages from `/admin/racing/`.
5. Run **Sync now** and verify the source, run, change, and alert records.

## Schedule and Limits

- Cron schedule: `2-59/5 * * * *`.
- The existing refund job remains on `*/5 * * * *`.
- No LLM request occurs for an HTTP 304 response or an unchanged normalized hash.
- One source extraction has a 90-second LLM timeout and one controlled retry.
- The last valid race data remains public if a source or model fails.

## Linux Cutover

Run the model behind HTTPS and authentication. Point `RACE_LLM_BASE_URL`,
`RACE_LLM_API_KEY`, and `RACE_LLM_MODEL` to the Linux endpoint. No database migration,
Cron change, or frontend rebuild is required.
