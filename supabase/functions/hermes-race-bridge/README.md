# Hermes race bridge

This Edge Function is an outbound-polled, asynchronous boundary between the existing
MRC race-feed workflow and the native Hermes server. It does not give Hermes a Supabase
key and does not update production race data directly.

## Deployment order

1. Review and apply `supabase/migrations/20260814010930_hermes_race_bridge.sql`.
2. Generate two independent 256-bit secrets:

   ```bash
   openssl rand -hex 32  # MRC_HERMES_WORKER_TOKEN
   openssl rand -hex 32  # MRC_HERMES_INTERNAL_TOKEN
   ```

3. Store both as Supabase Edge Function secrets. Store only the worker token on the
   Hermes server in `/etc/hermes/mrc.env`.
4. Set these Edge Function secrets:

   ```text
   MRC_HERMES_BRIDGE_MODE=shadow
   MRC_HERMES_DELEGATION_MODE=explicit
   MRC_HERMES_PERMITTED_SOURCES=4racing.com,goldcircle.co.za,sportingpost.co.za,racingandsports.com.au
   MRC_ALLOWED_ORIGIN=https://www.mrcracing.co.za
   ```

5. Deploy `hermes-race-bridge` with JWT verification disabled because it performs its
   own constant-time worker/internal-token checks and administrator JWT validation.
6. Redeploy `sync-race-data`. Normal tasks remain on its existing provider. A task is
   delegated only when its payload contains `delegate_to_hermes: true` or
   `provider: "hermes"`.

## Rollout

Keep both `MRC_HERMES_BRIDGE_MODE=shadow` and delegation mode `explicit` for seven days.
Inspect job events, returned evidence, warnings, conflicts and retry behavior. Moving to
`proposal` creates a proposal only when the result shape matches the existing proposal
workflow; it still does not apply or ingest website data.

## Worker API

- `POST /jobs`: internal token or administrator JWT; idempotent on `correlation_id`.
- `POST /claim`: worker token; creates a 15-minute lease.
- `POST /heartbeat`: worker token; renews an active matching lease.
- `POST /result`: worker token; validates schema, HTTPS sources and evidence hash.
- `POST /failure`: worker token; schedules retry, maximum three attempts.
- `GET /health`: no secrets or queue data.

Private tables use forced RLS and are available only to the Edge Function's service-role
client. Rate limits are persisted in the private schema, and worker result/failure calls
must match the active lease owner.
