#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$INSTALL_DIR/.env" ]] || { echo "Run bootstrap.sh first." >&2; exit 1; }

bash "$SCRIPT_DIR/sync-edge-functions.sh"
cd "$INSTALL_DIR"

grep -q '^PAYMENTS_ENABLED=false$' .env.functions \
  || { echo "Development payments must remain disabled." >&2; exit 1; }

docker compose up -d --wait
docker compose exec -T db psql -U postgres -d postgres --set ON_ERROR_STOP=1 -f - \
  < "$SCRIPT_DIR/verify-development-clone.sql"

bash "$SCRIPT_DIR/sync-public-storage.sh"

curl -fsS "https://api-dev.mrcracing.co.za/auth/v1/health" >/dev/null
echo "Self-hosted Supabase development stack is healthy."
