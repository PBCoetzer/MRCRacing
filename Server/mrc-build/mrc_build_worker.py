#!/usr/bin/env python3
"""Poll the private MRC build queue and create rollback-safe static releases."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path


REPOSITORY = Path(os.environ.get("MRC_REPOSITORY", "/srv/mrc-site/repository"))
STATE_DIRECTORY = Path(os.environ.get("MRC_BUILD_STATE", "/var/lib/mrc-build"))
WORKER_ID = os.environ.get("MRC_BUILD_WORKER_ID", "influx-mrc-build-1")
BRIDGE_URL = os.environ["MRC_SITE_BUILD_BRIDGE_URL"].rstrip("/")
WORKER_TOKEN = os.environ["MRC_SITE_BUILD_WORKER_TOKEN"]
BUILD_MODE = os.environ.get("MRC_BUILD_MODE", "shadow").strip().lower()
XNEELO_CONFIG = Path(os.environ.get("MRC_XNEELO_CONFIG", "/etc/mrc-site/xneelo-deploy.json"))
XNEELO_PASSWORD_FILE = Path(os.environ.get("MRC_XNEELO_PASSWORD_FILE", "/etc/mrc-site/xneelo.password"))


def request(route: str, payload: dict[str, object]) -> dict[str, object]:
    body = json.dumps({"worker_id": WORKER_ID, **payload}).encode()
    call = urllib.request.Request(
        f"{BRIDGE_URL}/{route}",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-mrc-site-build-token": WORKER_TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(call, timeout=45) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        message = error.read().decode(errors="replace")[:1000]
        raise RuntimeError(f"Bridge {route} returned HTTP {error.code}: {message}") from error


def run(command: list[str], cwd: Path = REPOSITORY, stdin: str | None = None, timeout: int = 2700) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        input=stdin,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env={**os.environ, "CI": "true", "NEXT_TELEMETRY_DISABLED": "1"},
    )
    if result.returncode:
        combined = "\n".join(part for part in (result.stdout, result.stderr) if part)
        raise RuntimeError(f"{' '.join(command[:3])} failed: {combined[-4000:]}")
    return result.stdout.strip()


def write_build_environment() -> None:
    names = (
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_PAYMENTS_ENABLED",
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
        "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
        "NEXT_PUBLIC_GA4_MEASUREMENT_ID",
    )
    values = [f"{name}={os.environ[name]}" for name in names if os.environ.get(name)]
    destination = REPOSITORY / "Frontend" / ".env.local"
    destination.write_text("\n".join(values) + "\n", encoding="utf-8")
    destination.chmod(0o600)


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(directory).as_posix().encode())
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


def verify_live_site() -> None:
    for url in (
        "https://www.mrcracing.co.za/",
        "https://www.mrcracing.co.za/robots.txt",
        "https://www.mrcracing.co.za/sitemap.xml",
    ):
        call = urllib.request.Request(url, headers={"user-agent": "MRC build verifier/1.0"})
        with urllib.request.urlopen(call, timeout=30) as response:
            if response.status != 200:
                raise RuntimeError(f"Live verification failed for {url}: HTTP {response.status}")


def build_and_maybe_deploy() -> tuple[str, str, dict[str, object]]:
    run(["git", "fetch", "--prune", "origin"])
    run(["git", "checkout", "--detach", "origin/main"])
    commit = run(["git", "rev-parse", "HEAD"])
    write_build_environment()
    frontend = REPOSITORY / "Frontend"
    if shutil_disk_free_gib(REPOSITORY) < 8:
        raise RuntimeError("Build cancelled: less than 8 GiB free on /srv/mrc-site.")
    run(["npm", "ci", "--no-audit", "--no-fund"], cwd=frontend)
    run(["npm", "run", "lint", "--", "--max-warnings=0"], cwd=frontend)
    run(["npm", "run", "build:static"], cwd=frontend)
    output_hash = directory_hash(frontend / "out")
    deployment: dict[str, object] = {"mode": BUILD_MODE, "commit": commit, "outputSha256": output_hash}

    if BUILD_MODE == "deploy":
        password = XNEELO_PASSWORD_FILE.read_text(encoding="utf-8").strip()
        if not password:
            raise RuntimeError("Xneelo deployment credential is empty.")
        deploy_output = run(
            [str(STATE_DIRECTORY / "venv" / "bin" / "python"), str(REPOSITORY / "Deployment" / "deploy_xneelo.py"), "--config", str(XNEELO_CONFIG)],
            stdin=password + "\n",
        )
        deployment["xneelo"] = json.loads(deploy_output)
        verify_live_site()

    return commit, output_hash, deployment


def shutil_disk_free_gib(path: Path) -> float:
    import shutil
    return shutil.disk_usage(path).free / (1024 ** 3)


def maintain_lease(job_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(60):
        try:
            response = request("heartbeat", {"job_id": job_id})
            if response.get("status") != "leased":
                print(f"Build lease heartbeat was rejected for {job_id}.", file=sys.stderr)
                return
        except Exception as error:
            print(f"Build lease heartbeat failed for {job_id}: {error}", file=sys.stderr)


def main() -> int:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with (STATE_DIRECTORY / "worker.lock").open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "busy"}))
            return 0

        claimed = request("claim", {})
        job = claimed.get("job")
        if claimed.get("status") == "idle" or not isinstance(job, dict):
            print(json.dumps({"status": "idle"}))
            return 0
        job_id = str(job.get("id", ""))
        heartbeat_stop = threading.Event()
        heartbeat = threading.Thread(
            target=maintain_lease,
            args=(job_id, heartbeat_stop),
            name="mrc-build-heartbeat",
            daemon=True,
        )
        heartbeat.start()
        try:
            commit, output_hash, manifest = build_and_maybe_deploy()
            heartbeat_stop.set()
            heartbeat.join(timeout=5)
            completed = request("complete", {
                "job_id": job_id,
                "deployed_commit_sha": commit,
                "output_sha256": output_hash,
                "build_manifest": manifest,
            })
            print(json.dumps(completed))
            return 0
        except Exception as error:
            heartbeat_stop.set()
            heartbeat.join(timeout=5)
            safe_error = str(error).replace("\n", " ")[-1000:]
            try:
                request("failure", {"job_id": job_id, "error": safe_error})
            except Exception as report_error:
                safe_error = f"{safe_error}; failure report also failed: {report_error}"
            print(safe_error, file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
