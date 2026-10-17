#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run this installer as root." >&2
  exit 1
}

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install_root=/usr/local/lib/mrc-site-watchdog

for required in \
  mrc_site_watchdog.py \
  mrc-site-watchdog.service \
  mrc-site-watchdog.timer
do
  [[ -f "${source_dir}/${required}" ]] || {
    echo "Missing ${required}." >&2
    exit 1
  }
done

[[ -x /usr/local/lib/hermes-tools/failure-notify.sh ]] || {
  echo "The existing Hermes Telegram incident notifier is unavailable." >&2
  exit 1
}

install -d -m 0755 -o root -g root "${install_root}"
install -m 0755 -o root -g root \
  "${source_dir}/mrc_site_watchdog.py" \
  "${install_root}/mrc_site_watchdog.py"
install -m 0644 -o root -g root \
  "${source_dir}/mrc-site-watchdog.service" \
  /etc/systemd/system/mrc-site-watchdog.service
install -m 0644 -o root -g root \
  "${source_dir}/mrc-site-watchdog.timer" \
  /etc/systemd/system/mrc-site-watchdog.timer

systemctl daemon-reload
systemctl enable --now mrc-site-watchdog.timer
systemctl start mrc-site-watchdog.service
systemctl --no-pager --full status mrc-site-watchdog.service
systemctl --no-pager --full status mrc-site-watchdog.timer
