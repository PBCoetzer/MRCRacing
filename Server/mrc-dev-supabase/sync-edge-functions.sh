#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly SOURCE_DIR="$REPO_ROOT/supabase/functions"
readonly TARGET_DIR="$INSTALL_DIR/volumes/functions"

[[ -d "$SOURCE_DIR" ]] || { echo "Missing source functions: $SOURCE_DIR" >&2; exit 1; }
[[ -d "$TARGET_DIR/main" ]] || { echo "Missing self-hosted function dispatcher: $TARGET_DIR/main" >&2; exit 1; }

for source in "$SOURCE_DIR"/*; do
  name=$(basename "$source")
  [[ -d "$source" ]] || continue
  rm -rf "$TARGET_DIR/$name"
  cp -a "$source" "$TARGET_DIR/$name"
done

install -m 0644 "$SOURCE_DIR/deno.json" "$TARGET_DIR/deno.jsonc"

echo "Synced MRC Edge Functions into $TARGET_DIR."
echo "Sensitive functions perform their own user-token checks; payments remain disabled in .env.functions."
