#!/usr/bin/env bash
set -euo pipefail

STAGE=/home/briewel/mrc-build-bootstrap
if [[ ${EUID} -ne 0 ]]; then
  echo "Run this bootstrap as root." >&2
  exit 1
fi
for required in "$STAGE/mrc_build_worker.py" "$STAGE/mrc-build.service" "$STAGE/mrc-build.timer" "$STAGE/worker.env" "$STAGE/xneelo.password" "$STAGE/xneelo-deploy.json" "$STAGE/xneelo-known-hosts"; do
  [[ -f "$required" ]] || { echo "Missing staged file: $required" >&2; exit 1; }
done

if ! dpkg-query -W -f='${Status}' python3-venv 2>/dev/null | grep -q 'ok installed'; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv
fi

if ! id mrc-build >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/mrc-build --create-home --shell /usr/sbin/nologin mrc-build
fi
install -d -o root -g mrc-build -m 0750 /etc/mrc-site
install -d -o root -g root -m 0755 /opt/mrc-build
install -d -o mrc-build -g mrc-build -m 0750 /srv/mrc-site /srv/mrc-site/backups /var/lib/mrc-build
install -d -o mrc-build -g mrc-build -m 0700 /var/lib/mrc-build/.ssh
install -m 0755 "$STAGE/mrc_build_worker.py" /opt/mrc-build/mrc_build_worker.py
install -o root -g mrc-build -m 0640 "$STAGE/worker.env" /etc/mrc-site/worker.env
install -o root -g mrc-build -m 0640 "$STAGE/xneelo.password" /etc/mrc-site/xneelo.password

install -o root -g mrc-build -m 0640 "$STAGE/xneelo-deploy.json" /etc/mrc-site/xneelo-deploy.json
install -o mrc-build -g mrc-build -m 0600 "$STAGE/xneelo-known-hosts" /var/lib/mrc-build/.ssh/known_hosts

if [[ ! -d /srv/mrc-site/repository/.git ]]; then
  runuser -u mrc-build -- git clone https://github.com/PBCoetzer/MRCRacing.git /srv/mrc-site/repository
fi
runuser -u mrc-build -- git -C /srv/mrc-site/repository fetch --prune origin

python3 -m venv /var/lib/mrc-build/venv
/var/lib/mrc-build/venv/bin/pip install --disable-pip-version-check --no-cache-dir 'paramiko==4.0.0'
chown -R mrc-build:mrc-build /var/lib/mrc-build /srv/mrc-site

install -m 0644 "$STAGE/mrc-build.service" /etc/systemd/system/mrc-build.service
install -m 0644 "$STAGE/mrc-build.timer" /etc/systemd/system/mrc-build.timer
systemctl daemon-reload
systemctl enable --now mrc-build.timer
systemctl start mrc-build.service
systemctl --no-pager --full status mrc-build.service || true
systemctl --no-pager --full status mrc-build.timer

rm -f "$STAGE/worker.env" "$STAGE/xneelo.password"
echo "MRC build worker installed. It remains in shadow mode until MRC_BUILD_MODE is changed to deploy."
