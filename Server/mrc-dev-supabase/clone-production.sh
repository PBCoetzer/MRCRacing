#!/usr/bin/env bash
set -Eeuo pipefail

readonly SUPABASE_CLI_VERSION="2.118.0"
readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '===> %s\n' "$*"; }

[[ "$(uname -s)" == "Linux" ]] || die "This clone must run on the Linux development server."
[[ -f "$INSTALL_DIR/docker-compose.yml" ]] || die "Run bootstrap.sh first."
command -v docker >/dev/null || die "Docker is required."
command -v npx >/dev/null || die "Node.js and npx are required for the pinned Supabase CLI."

if [[ -z "${PRODUCTION_DATABASE_URL:-}" ]]; then
  read -r -s -p "Production Supabase database connection URL: " PRODUCTION_DATABASE_URL
  printf '\n'
fi
[[ "$PRODUCTION_DATABASE_URL" == postgres* ]] || die "PRODUCTION_DATABASE_URL must be a Postgres connection URL."

work_dir=$(mktemp -d)
chmod 0700 "$work_dir"
cleanup() {
  unset PRODUCTION_DATABASE_URL
  rm -rf "$work_dir"
}
trap cleanup EXIT

cd "$INSTALL_DIR"
docker compose up -d --wait db

existing_rows=$(docker compose exec -T db psql -U postgres -d postgres -Atqc \
  "select case when to_regclass('public.profiles') is null then 0 else (select count(*) from public.profiles) end")
if [[ "$existing_rows" != "0" && "${ALLOW_REPLACE_DEVELOPMENT_DATABASE:-}" != "YES" ]]; then
  die "The development database already contains application data. Set ALLOW_REPLACE_DEVELOPMENT_DATABASE=YES only after taking a development backup."
fi
if [[ "$existing_rows" != "0" ]]; then
  log "Removing the existing development-only Docker volumes before the replacement clone."
  docker compose down --volumes
  docker compose up -d --wait db
fi

log "Creating an encrypted-in-transit temporary dump with the pinned Supabase CLI."
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db dump \
  --db-url "$PRODUCTION_DATABASE_URL" \
  --file "$work_dir/roles.sql" \
  --role-only
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db dump \
  --db-url "$PRODUCTION_DATABASE_URL" \
  --file "$work_dir/schema.sql"
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db dump \
  --db-url "$PRODUCTION_DATABASE_URL" \
  --file "$work_dir/data.sql" \
  --data-only \
  --use-copy \
  --exclude "auth.audit_log_entries,auth.custom_oauth_providers,auth.flow_state,auth.instances,auth.mfa_amr_claims,auth.mfa_challenges,auth.mfa_factors,auth.mfa_recovery_code_sets,auth.mfa_recovery_codes,auth.oauth_authorizations,auth.oauth_client_states,auth.oauth_clients,auth.oauth_consents,auth.one_time_tokens,auth.refresh_tokens,auth.saml_providers,auth.saml_relay_states,auth.schema_migrations,auth.scim_tokens,auth.scim_users,auth.sessions,auth.sso_domains,auth.sso_providers,auth.webauthn_challenges,auth.webauthn_credentials,public.admin_email_confirmation_actions,public.admin_user_notes,public.audit_logs,public.auth_email_delivery_events,public.auth_email_messages,public.auth_user_diagnostic_events,public.notification_outbox,public.notifications,public.site_build_jobs,public.tipster_application_documents,storage.buckets_analytics,storage.migrations,storage.objects,storage.s3_multipart_uploads,storage.s3_multipart_uploads_parts,storage.vector_indexes"

log "Restoring and sanitizing in one transaction. Raw dump files are deleted on exit."
{
  cat "$work_dir/roles.sql"
  cat "$work_dir/schema.sql"
  printf '\nset session_replication_role = replica;\n'
  cat "$work_dir/data.sql"
  printf '\nset session_replication_role = origin;\n'
  cat "$SCRIPT_DIR/sanitize-development-clone.sql"
} | docker compose exec -T db psql \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  -U postgres \
  -d postgres

log "Running privacy and financial-integrity checks."
docker compose exec -T db psql -U postgres -d postgres \
  --set ON_ERROR_STOP=1 \
  -f - < "$SCRIPT_DIR/verify-development-clone.sql"

log "Sanitized development clone completed. Configure controlled test users before starting the public stack."
