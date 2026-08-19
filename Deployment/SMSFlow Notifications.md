# SMSFlow transactional notifications

MRC Racing sends only opted-in service alerts through SMSFlow. Marketing SMS consent is stored separately and is not used by the delivery worker.

## Required Supabase Edge Function secrets

Add these in **Supabase Dashboard → Edge Functions → Secrets**:

- `SMSFLOW_CLIENT_ID` — the SMSFlow API client ID.
- `SMSFLOW_CLIENT_SECRET` — the one-time client secret. Never commit it or paste it into frontend configuration.
- `SMSFLOW_BASE_URL` — optional; defaults to `https://portal.smsflow.co.za`.

Deploy `deliver-sms-notifications` only from the server-side repository. The function authenticates to SMSFlow, normalizes South African mobile numbers, honours SMSFlow opt-outs, deduplicates notifications through the database outbox, and retries temporary failures with bounded backoff.

The function accepts only the existing protected notification-worker token or service-role authentication. It is never called from the browser.

## Activation

1. Add the two SMSFlow credentials as Edge Function secrets.
2. Invoke the function once manually and confirm a zero-job response.
3. Add a server-side schedule using the existing notification-worker token.
4. Enable SMS alerts on a test client with a valid South African mobile number.
5. Publish a private test card and verify a single SMS and one delivered outbox record.

Do not schedule delivery until the production SMSFlow key replaces the Development key.
