# API Research

Status: initial research plan

## Sports Data Categories

MRC Website needs data for:

- Horse racing race cards and results.
- Soccer fixtures, results, and live scores.
- Rugby fixtures, results, and live scores.
- Cricket fixtures, results, and live scores.
- Tennis fixtures, results, and live scores.
- UFC and boxing events and results.
- Greyhound racing race cards and results.

## Provider Requirements

- Clear commercial licensing for paid tipping products.
- South African racing coverage where possible.
- Reliable historical results.
- Upcoming fixture feeds.
- Rate limits suitable for homepage, dashboards, and admin sync jobs.
- Webhook or polling-friendly update model.
- Stable identifiers for fixtures, runners, teams, fighters, and results.

## Integration Architecture

- Use `sports_data_provider` adapters.
- Normalize external data into local `sports`, `fixtures`, and `results` tables.
- Store provider IDs to support reconciliation.
- Keep provider credentials in server-only environment variables.
- Cache public homepage data to reduce API costs.

## Pending Detailed Research

- Compare horse racing specific providers.
- Compare general sports APIs for soccer, rugby, cricket, tennis, UFC, and boxing.
- Confirm licensing for commercial use in South Africa.
- Document pricing, rate limits, update frequency, and support quality.
