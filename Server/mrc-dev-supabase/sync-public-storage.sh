#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR="${MRC_DEV_SUPABASE_DIR:-/opt/mrc-dev-supabase}"
readonly SOURCE_STORAGE_URL="https://cjgfvqgiqrphmakruqnk.supabase.co/storage/v1/object/public/blog-media"
readonly TARGET_STORAGE_URL="https://api-dev.mrcracing.co.za/storage/v1/object/blog-media"

[[ -f "$INSTALL_DIR/.env" ]] || { echo "Run bootstrap.sh first." >&2; exit 1; }
cd "$INSTALL_DIR"

service_role_key=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)
[[ -n "$service_role_key" ]] || { echo "SERVICE_ROLE_KEY is missing." >&2; exit 1; }

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT

docker compose exec -T db psql -U postgres -d postgres -Atqc \
  "select distinct cover_image_path from public.blog_posts where cover_image_path is not null and cover_image_path <> '' order by cover_image_path" \
  > "$temp_dir/paths.txt"

while IFS= read -r object_path; do
  [[ -n "$object_path" ]] || continue
  [[ "$object_path" =~ ^[A-Za-z0-9._/-]+$ && "$object_path" != *".."* ]] \
    || { echo "Unsafe Storage object path: $object_path" >&2; exit 1; }

  object_file="$temp_dir/$(printf '%s' "$object_path" | sha256sum | cut -d' ' -f1).bin"
  curl -fsS "$SOURCE_STORAGE_URL/$object_path" -o "$object_file"
  curl -fsS -X POST "$TARGET_STORAGE_URL/$object_path" \
    -H "apikey: $service_role_key" \
    -H "Authorization: Bearer $service_role_key" \
    -H "x-upsert: true" \
    -H "Content-Type: image/webp" \
    --data-binary "@$object_file" >/dev/null
done < "$temp_dir/paths.txt"

echo "Copied public blog media into development Storage. Private Storage objects were not copied."
