#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly API_URL="https://api-dev.mrcracing.co.za"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "$INSTALL_DIR/.env" ]] || die "Run bootstrap.sh first."
cd "$INSTALL_DIR"

service_role_key=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
[[ -n "$service_role_key" ]] || die "SERVICE_ROLE_KEY is missing."

query_id() {
  docker compose exec -T db psql -U postgres -d postgres -Atqc "$1" | head -n1
}

admin_id=$(query_id "select user_id from public.user_roles where role = 'administrator' order by user_id limit 1")
tipster_id=$(query_id "select t.user_id from public.tipsters t where t.is_verified and not exists (select 1 from public.user_roles r where r.user_id=t.user_id and r.role='administrator') order by t.user_id limit 1")
client_id=$(query_id "select p.id from public.profiles p where not exists (select 1 from public.tipsters t where t.user_id=p.id) and not exists (select 1 from public.user_roles r where r.user_id=p.id and r.role='administrator') order by p.id limit 1")

[[ -n "$admin_id" && -n "$tipster_id" && -n "$client_id" ]] || die "Could not identify representative admin, tipster, and client users."

configure_user() {
  local user_id="$1" email="$2" label="$3" password payload
  read -r -s -p "Password for ${label} (${email}): " password
  printf '\n'
  [[ ${#password} -ge 12 ]] || die "Use at least 12 characters for ${label}."
  payload=$(jq -cn --arg email "$email" --arg password "$password" --arg label "$label" \
    '{email:$email,password:$password,email_confirm:true,user_metadata:{display_name:$label,development_clone:true}}')
  printf '%s' "$payload" | curl -fsS -X PUT "$API_URL/auth/v1/admin/users/$user_id" \
    -H "apikey: $service_role_key" \
    -H "Authorization: Bearer $service_role_key" \
    -H "Content-Type: application/json" \
    --data-binary @- >/dev/null
  unset password payload
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v display_name="$label" \
    -c "update public.profiles set display_name = :'display_name', first_name = split_part(:'display_name',' ',1), last_name = null, email_notifications_enabled = false, updated_at = now() where id = :'user_id'::uuid" >/dev/null
}

configure_user "$admin_id" "admin@dev.mrcracing.test" "Development Admin"
configure_user "$tipster_id" "tipster@dev.mrcracing.test" "Development Tipster"
configure_user "$client_id" "client@dev.mrcracing.test" "Development Client"

echo "Controlled development logins configured. Passwords were not stored by this script."
