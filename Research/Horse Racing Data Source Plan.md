# MRC Racing Data Source Plan

## Decision

MRC Racing Tips stores and displays factual horse-racing data from Supabase. The public
website does not scrape race pages, call an LLM, or receive screenshot uploads.

An authenticated Supabase Edge Function checks administrator-approved public source
pages every five minutes. It uses conditional HTTP requests and normalized content
hashes, then calls a configured external LLM only when the relevant source changes.

## Data Scope

- Meeting country, venue, date, status, and source timestamp.
- Race number, title, scheduled time, distance, class, and status.
- Runner number, horse, jockey, trainer, draw, weight, scratch status, and result.
- No odds, dividends, payouts, bookmaker markets, Lucky Pick, or Quick Pick data.

## Production Flow

1. Supabase Cron invokes `sync-race-data` at minutes 2, 7, 12, and so forth.
2. The function fetches enabled rows from `race_feed_sources`.
3. Unchanged pages stop before any LLM request.
4. Changed content is sent to an OpenAI-compatible structured-output endpoint.
5. A service-only RPC validates and atomically updates meetings, races, and runners.
6. Material changes create immutable audit events and affected-tipster alerts.
7. Entitled clients are notified only after the tipster publishes a correction.

## Linux Migration

The initial extractor can use an external LLM free tier. Later, set the same LLM base
URL, key, and model secrets to an authenticated HTTPS endpoint on the Linux server.
Supabase remains the scheduler, validator, database authority, and notification source.

The Linux host must not expose an unrestricted Ollama or vLLM port. Use a reverse proxy,
TLS, request authentication, rate limits, and a narrow OpenAI-compatible endpoint.
