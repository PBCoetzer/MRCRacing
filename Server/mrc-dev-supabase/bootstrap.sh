#!/usr/bin/env bash
set -Eeuo pipefail

readonly SUPABASE_REF="self-hosted/v0.8.2"
readonly SETUP_SHA256="b063655b6388924b33f331633e800c12179a48b53d217c059f674ec8b8e27189"
readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly API_URL="https://api-dev.mrcracing.co.za"
readonly SITE_URL="https://dev.mrcracing.co.za"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '===> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

set_env() {
  local key="$1" value="$2" env_file="$INSTALL_DIR/.env"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

[[ "$(uname -s)" == "Linux" ]] || die "This bootstrap must run on the Linux development server."
[[ "${EUID}" -eq 0 ]] || die "Run with sudo so Docker and /opt can be configured."

memory_mb=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
cpu_count=$(getconf _NPROCESSORS_ONLN)
available_gb=$(df -Pk /opt | awk 'NR==2 {print int($4 / 1024 / 1024)}')

(( memory_mb >= 4096 )) || die "At least 4 GB RAM is required; found ${memory_mb} MB."
(( cpu_count >= 2 )) || die "At least 2 CPU cores are required; found ${cpu_count}."
(( available_gb >= 40 )) || die "At least 40 GB free under /opt is required; found ${available_gb} GB."

if (( memory_mb < 8192 || cpu_count < 4 || available_gb < 80 )); then
  log "Resource warning: 8 GB RAM, 4 CPUs, and 80 GB free are recommended because this server also runs MRC workers."
fi

if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  log "Installing pinned Supabase ${SUPABASE_REF} into ${INSTALL_DIR}."
  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/supabase/supabase/${SUPABASE_REF}/docker/setup.sh" -o "$temp_dir/setup.sh"
  printf '%s  %s\n' "$SETUP_SHA256" "$temp_dir/setup.sh" | sha256sum --check --status \
    || die "Pinned Supabase setup script checksum did not match."
  chmod 0755 "$temp_dir/setup.sh"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  (
    cd "$(dirname "$INSTALL_DIR")"
    sh "$temp_dir/setup.sh" --yes --project-dir "$(basename "$INSTALL_DIR")" --ref "$SUPABASE_REF"
  )
else
  log "Existing Supabase runtime found; preserving its generated secrets."
fi

[[ -f "$INSTALL_DIR/.supabase-version" ]] || die "Supabase version stamp is missing."
grep -q "ref=${SUPABASE_REF}" "$INSTALL_DIR/.supabase-version" \
  || die "Runtime is not pinned to ${SUPABASE_REF}; review the upgrade before continuing."

install -m 0644 "$SCRIPT_DIR/docker-compose.mrc-dev.yml" "$INSTALL_DIR/docker-compose.mrc-dev.yml"
if [[ ! -f "$INSTALL_DIR/.env.functions" ]]; then
  install -m 0600 "$SCRIPT_DIR/.env.functions.example" "$INSTALL_DIR/.env.functions"
fi

set_env COMPOSE_FILE "docker-compose.yml:docker-compose.caddy.yml:docker-compose.mrc-dev.yml"
set_env SUPABASE_PUBLIC_URL "$API_URL"
set_env API_EXTERNAL_URL "$API_URL/auth/v1"
set_env SITE_URL "$SITE_URL"
set_env ADDITIONAL_REDIRECT_URLS "$SITE_URL/**"
set_env PROXY_DOMAIN "api-dev.mrcracing.co.za"
set_env CERTBOT_EMAIL "admin@mrcracing.co.za"
set_env STUDIO_DEFAULT_ORGANIZATION "MRC Racing Development"
set_env STUDIO_DEFAULT_PROJECT "MRC Racing Development"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "true"
set_env ENABLE_PHONE_SIGNUP "false"
set_env ENABLE_PHONE_AUTOCONFIRM "false"
set_env DISABLE_SIGNUP "false"
set_env FUNCTIONS_VERIFY_JWT "false"

chmod 0600 "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.functions"

log "Starting only the private database for the sanitized restore."
(
  cd "$INSTALL_DIR"
  docker compose up -d --wait db
)

log "Bootstrap complete. Do not start the public stack until clone-production.sh succeeds."
log "Generated client key is stored in ${INSTALL_DIR}/.env as SUPABASE_PUBLISHABLE_KEY."
