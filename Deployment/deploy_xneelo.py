#!/usr/bin/env python3
"""Rollback-safe static-site deployment to the MRC Xneelo SFTP account."""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import shutil
import stat
import sys
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

import paramiko


PRESERVED_PREFIXES = (".well-known/", "cgi-bin/", "_next/static/chunks/")
PRESERVED_FILES = {".ftpquota", "error_log"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    return parser.parse_args()


def remote_join(root: str, relative: str) -> str:
    return posixpath.join(root, *Path(relative).parts)


def walk_remote(sftp: paramiko.SFTPClient, root: str) -> dict[str, int]:
    files: dict[str, int] = {}

    def visit(directory: str, relative_directory: str = "") -> None:
        for entry in sftp.listdir_attr(directory):
            relative = posixpath.join(relative_directory, entry.filename)
            remote_path = posixpath.join(directory, entry.filename)
            if stat.S_ISDIR(entry.st_mode):
                visit(remote_path, relative)
            elif stat.S_ISREG(entry.st_mode):
                files[relative] = entry.st_size

    visit(root)
    return files


def ensure_remote_directory(
    sftp: paramiko.SFTPClient, root: str, relative_directory: str, known: set[str]
) -> None:
    current = root
    for part in Path(relative_directory).parts:
        current = posixpath.join(current, part)
        if current in known:
            continue
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)
        known.add(current)


def local_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def remote_hash(sftp: paramiko.SFTPClient, path: str) -> str:
    digest = hashlib.sha256()
    with sftp.open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_backup(
    sftp: paramiko.SFTPClient,
    remote_root: str,
    remote_files: dict[str, int],
    backup_path: Path,
) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in sorted(remote_files):
            with sftp.open(remote_join(remote_root, relative), "rb") as source:
                with archive.open(relative, "w") as destination:
                    shutil.copyfileobj(source, destination, 1024 * 1024)


def upload_priority(relative: str) -> tuple[int, str]:
    lower = relative.lower()
    if lower.startswith("_next/") or lower.startswith("images/"):
        return (0, relative)
    if lower.endswith(".html") or lower == ".htaccess":
        return (3, relative)
    if lower.endswith(".txt"):
        return (2, relative)
    return (1, relative)


def remote_safe_relative(relative: str) -> str:
    """Map generated Next route-token filenames to names accepted by Xneelo SFTP."""
    return relative.replace("$", "_")


def replace_remote_file(
    sftp: paramiko.SFTPClient,
    local_path: Path,
    remote_path: str,
    release_id: str,
) -> None:
    temporary_path = f"{remote_path}.codex-upload-{release_id}"
    sftp.put(str(local_path), temporary_path)
    try:
        sftp.posix_rename(temporary_path, remote_path)
    except (OSError, IOError):
        try:
            sftp.remove(remote_path)
        except FileNotFoundError:
            pass
        sftp.rename(temporary_path, remote_path)


def should_preserve(relative: str) -> bool:
    return relative in PRESERVED_FILES or relative.startswith(PRESERVED_PREFIXES)


def remove_empty_directories(sftp: paramiko.SFTPClient, root: str) -> None:
    directories: list[str] = []

    def visit(directory: str, relative_directory: str = "") -> None:
        for entry in sftp.listdir_attr(directory):
            if not stat.S_ISDIR(entry.st_mode):
                continue
            relative = posixpath.join(relative_directory, entry.filename)
            if relative.startswith((".well-known", "cgi-bin")):
                continue
            remote_path = posixpath.join(directory, entry.filename)
            visit(remote_path, relative)
            directories.append(remote_path)

    visit(root)
    for directory in sorted(directories, key=lambda item: item.count("/"), reverse=True):
        try:
            sftp.rmdir(directory)
        except OSError:
            pass


def main() -> int:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    deployment_directory = config_path.parent
    local_output = (deployment_directory / config["localOutput"]).resolve()
    backup_directory = (deployment_directory / config["backupDirectory"]).resolve()
    password = sys.stdin.readline().rstrip("\r\n")

    if not password:
        raise RuntimeError("The encrypted Xneelo password could not be read.")
    if not (local_output / "index.html").is_file():
        raise RuntimeError(f"Static export not found at {local_output}.")

    local_files: dict[str, Path] = {}
    for path in local_output.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(local_output).as_posix()
        remote_relative = remote_safe_relative(relative)
        if remote_relative in local_files:
            raise RuntimeError(
                f"Static export contains colliding Xneelo paths: {relative} and "
                f"{local_files[remote_relative].relative_to(local_output).as_posix()}."
            )
        local_files[remote_relative] = path
    release_id = uuid.uuid4().hex[:12]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_directory / f"public_html-before-{timestamp}.zip"

    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(
            hostname=config["host"],
            port=int(config["port"]),
            username=config["username"],
            password=password,
            look_for_keys=False,
            allow_agent=False,
            timeout=20,
            auth_timeout=20,
        )
        transport = client.get_transport()
        if transport is not None:
            transport.set_keepalive(30)
        with client.open_sftp() as sftp:
            remote_root = sftp.normalize(config["remoteRoot"])
            before = walk_remote(sftp, remote_root)
            print(
                f"Backing up {len(before)} live file(s) to {backup_path}...",
                file=sys.stderr,
                flush=True,
            )
            create_backup(sftp, remote_root, before, backup_path)

            known_directories = {remote_root}
            uploaded = 0
            unchanged = 0
            ordered_files = sorted(local_files.items(), key=lambda pair: upload_priority(pair[0]))
            for index, (relative, local_path) in enumerate(ordered_files, start=1):
                remote_path = remote_join(remote_root, relative)
                if relative in before:
                    try:
                        if local_hash(local_path) == remote_hash(sftp, remote_path):
                            unchanged += 1
                            if index % 25 == 0 or index == len(ordered_files):
                                print(
                                    f"Checked {index}/{len(ordered_files)} file(s); "
                                    f"uploaded {uploaded}, unchanged {unchanged}...",
                                    file=sys.stderr,
                                    flush=True,
                                )
                            continue
                    except FileNotFoundError:
                        pass
                relative_directory = posixpath.dirname(relative)
                try:
                    if relative_directory:
                        ensure_remote_directory(sftp, remote_root, relative_directory, known_directories)
                    replace_remote_file(
                        sftp,
                        local_path,
                        remote_path,
                        release_id,
                    )
                except Exception as error:
                    raise RuntimeError(
                        f"Could not publish {relative} to {remote_path}: {error}"
                    ) from error
                if local_hash(local_path) != remote_hash(sftp, remote_path):
                    raise RuntimeError(
                        f"Hash verification failed for {relative}; backup retained at {backup_path}."
                    )
                uploaded += 1
                if index % 25 == 0 or index == len(ordered_files):
                    print(
                        f"Checked {index}/{len(ordered_files)} file(s); "
                        f"uploaded {uploaded}, unchanged {unchanged}...",
                        file=sys.stderr,
                        flush=True,
                    )

            stale = sorted(set(before) - set(local_files))
            removed = 0
            preserved = 0
            for relative in stale:
                if should_preserve(relative):
                    preserved += 1
                    continue
                try:
                    sftp.remove(remote_join(remote_root, relative))
                    removed += 1
                except FileNotFoundError:
                    pass
            remove_empty_directories(sftp, remote_root)

            after = walk_remote(sftp, remote_root)
            missing = sorted(set(local_files) - set(after))
            if missing:
                raise RuntimeError(f"Post-deployment audit found {len(missing)} missing file(s).")

            print(
                json.dumps(
                    {
                        "status": "succeeded",
                        "host": config["host"],
                        "remoteRoot": config["remoteRoot"],
                        "localFilesVerified": len(local_files),
                        "filesUploaded": uploaded,
                        "filesAlreadyCurrent": unchanged,
                        "staleFilesRemoved": removed,
                        "legacyOrSystemFilesPreserved": preserved,
                        "remoteFileCount": len(after),
                        "backup": str(backup_path),
                    },
                    indent=2,
                )
            )
    finally:
        password = ""
        client.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Xneelo deployment failed: {error}", file=sys.stderr)
        raise SystemExit(1)
