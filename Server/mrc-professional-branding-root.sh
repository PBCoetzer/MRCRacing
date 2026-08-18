#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run this script as root." >&2
  exit 1
}

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
tool_root=/usr/local/lib/hermes-tools
backup_root=/var/backups/influx-server-branding/${timestamp}

install -d -m 0700 "${backup_root}"
for file in mrc_worker.py failure-notify.sh alert-recovery.sh email_digest.py hermes_mail.py; do
  install -m 0600 "${tool_root}/${file}" "${backup_root}/${file}"
done

python3 - <<'PY'
from pathlib import Path

replacements = {
    Path("/usr/local/lib/hermes-tools/mrc_worker.py"): {
        "Formgrids credentials are not configured for the Hermes worker.":
            "Formgrids credentials are not configured for the Influx race-verification worker.",
        "Hermes did not return the required JSON result object.":
            "The Influx verification engine did not return the required JSON result object.",
        'process.stderr or process.stdout or "Hermes failed."':
            'process.stderr or process.stdout or "Influx verification failed."',
        "No queued MRC Hermes job.": "No queued MRC verification job.",
        'f"MRC Hermes job {job_id} returned {result[\'status\']} in shadow/proposal workflow. "':
            'f"MRC Influx verification job {job_id} returned {result[\'status\']} in the proposal workflow. "',
        'f"Model {selected_model}; "': '"Verified by Influx Technologies; "',
        'f"{len(result[\'conflicts\'])} conflicts. Local trace: {trace_location}. Review: {ADMIN_URL}"':
            'f"{len(result[\'conflicts\'])} conflicts. Evidence trace: {trace_location}. Review: {ADMIN_URL}"',
        'notify(f"MRC Hermes job {job_id} failed: {detail}")':
            'notify(f"MRC Influx verification job {job_id} failed: {detail}")',
    },
    Path("/usr/local/lib/hermes-tools/failure-notify.sh"): {
        'message="Hermes server alert: $unit entered state $state at $(date --iso-8601=seconds). Repeated identical alerts will be suppressed until recovery or the error changes. Review with: sudo /usr/local/sbin/hermes-admin journal $unit"':
            'message="Influx Server alert: $unit entered state $state at $(date --iso-8601=seconds). Repeated identical alerts will be suppressed until recovery or the error changes. Review the approved service logs from the server console."',
    },
    Path("/usr/local/lib/hermes-tools/alert-recovery.sh"): {
        'message="Hermes server recovery: $unit is healthy again as of $(date --iso-8601=seconds). Duplicate-alert suppression has been reset."':
            'message="Influx Server recovery: $unit is healthy again as of $(date --iso-8601=seconds). Duplicate-alert suppression has been reset."',
    },
    Path("/usr/local/lib/hermes-tools/email_digest.py"): {
        "Hermes email digest: no new dedicated-mailbox messages in the last 24 hours.":
            "Influx company-mail digest: no new dedicated-mailbox messages in the last 24 hours.",
    },
    Path("/usr/local/lib/hermes-tools/hermes_mail.py"): {
        "Attachment is outside an approved Hermes directory:":
            "Attachment is outside an approved company-mail directory:",
        "Draft sender does not match the configured Hermes mailbox.":
            "Draft sender does not match the configured company mailbox.",
    },
}

for path, changes in replacements.items():
    original = path.read_text(encoding="utf-8")
    updated = original
    for old, new in changes.items():
        if old not in updated and new not in updated:
            raise SystemExit(f"Expected branding text was not found in {path}: {old}")
        updated = updated.replace(old, new)
    if updated != original:
        temporary = path.with_suffix(path.suffix + ".influx-new")
        temporary.write_text(updated, encoding="utf-8")
        temporary.chmod(path.stat().st_mode)
        temporary.replace(path)
PY

python3 -m py_compile \
  "${tool_root}/mrc_worker.py" \
  "${tool_root}/email_digest.py" \
  "${tool_root}/hermes_mail.py"
bash -n "${tool_root}/failure-notify.sh"
bash -n "${tool_root}/alert-recovery.sh"

build_env=/etc/mrc-site/build.env
turnstile_line='NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAD-wuYzDt5XYh_sf'
if [[ -f ${build_env} ]]; then
  install -m 0600 "${build_env}" "${backup_root}/mrc-build.env"
  if grep -q '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=' "${build_env}"; then
    sed -i "s|^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.*|${turnstile_line}|" "${build_env}"
  else
    printf '\n%s\n' "${turnstile_line}" >> "${build_env}"
  fi
fi

systemctl restart hermes-mrc-worker.timer
systemctl restart hermes-alert-recovery.timer
systemctl restart hermes-email-digest.timer

echo "Professional notification branding applied. Backup: ${backup_root}"
echo "The existing SSH key was not changed."
