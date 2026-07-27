# MRC Racing Data Source Plan

## Decision

MRC Racing Tips should publish only horse-racing data stored in Supabase. The website should not scrape bookmaker or race-card pages directly.

## Source-of-truth order

1. **Preferred authority: 4Racing commercial integration**
   - 4Racing describes its platform as the authoritative source for South African horse racing.
   - Its published Computaform material states that commercial display requires a licence.
   - Partnership contact: https://www.4racing.com/about/technology/
2. **Practical API candidate: ResultsZA**
   - Provides South African meetings, racecards, results, top-three finishers, and tote dividends through documented JSON endpoints.
   - Confirm that the selected subscription permits public commercial display before activation.
   - Documentation: https://resultsza.co.za/api_docs
   - Terms: https://resultsza.co.za/terms-of-service
3. **Not suitable as the primary South African feed: The Racing API**
   - Strong documented API, but its published coverage focuses on UK, Ireland, selected global group races, and selected handicaps.
   - Coverage: https://www.theracingapi.com/data-coverage

## Production flow

1. A scheduled Supabase Edge Function requests upcoming cards and completed results from the approved provider.
2. The function normalizes one race into one `public.fixtures` row.
3. Upserts use `source_name + external_id` to prevent duplicates.
4. The raw provider response is retained in `source_payload` for audit and troubleshooting.
5. The homepage queries Supabase at runtime and displays `source_name`, `source_url`, and `source_updated_at`.
6. Historical rows remain in Supabase after a race completes; they are updated with `result_summary` instead of being replaced or deleted.

## Required provider fields

- Provider meeting/race ID
- Venue and race title
- Scheduled start time with timezone
- Race status
- Official result summary
- Source verification URL
- Provider update timestamp
- Raw response payload

## Activation checklist

- Obtain written display/licensing approval or an API plan that permits commercial public display.
- Add the provider API key as a Supabase Edge Function secret, never as a `NEXT_PUBLIC_` value.
- Deploy the ingestion function.
- Schedule imports with Supabase Cron.
- Test duplicate imports, changed start times, abandoned races, and delayed results.
- Verify public RLS remains read-only and run Supabase security/performance advisors.
