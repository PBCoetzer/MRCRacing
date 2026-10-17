#!/usr/bin/env python3
"""Read-only availability and content checks for the live MRC site."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request


CHECKS = (
    ("homepage", "https://www.mrcracing.co.za/", ("mrc racing",)),
    ("horse-racing", "https://www.mrcracing.co.za/horse-racing/", ("horse racing",)),
    ("client", "https://www.mrcracing.co.za/client/", ("mrc racing",)),
    ("tipster", "https://www.mrcracing.co.za/tipster/", ("mrc racing",)),
    ("admin-racing", "https://www.mrcracing.co.za/admin/racing/", ("mrc racing",)),
    ("sitemap", "https://www.mrcracing.co.za/sitemap.xml", ("mrcracing.co.za",)),
    ("robots", "https://www.mrcracing.co.za/robots.txt", ("sitemap",)),
)

MEETING_URL_PATTERN = re.compile(
    r"https://www\.mrcracing\.co\.za/horse-racing/[^/<]+/(\d{4}-\d{2}-\d{2})/"
)


def check(
    name: str,
    url: str,
    required_fragments: tuple[str, ...],
) -> tuple[dict[str, object], str]:
    request = urllib.request.Request(
        url,
        headers={"user-agent": "MRC live-site watchdog/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(2_000_000).decode("utf-8", errors="replace")
            status = response.status
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{name} returned HTTP {error.code}: {url}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"{name} could not be reached: {url}: {error}") from error

    if status != 200:
        raise RuntimeError(f"{name} returned HTTP {status}: {url}")

    normalized_body = body.casefold()
    missing = [fragment for fragment in required_fragments if fragment.casefold() not in normalized_body]
    if missing:
        raise RuntimeError(
            f"{name} returned unexpected content; missing {', '.join(missing)}: {url}"
        )

    return (
        {"name": name, "url": url, "status": status, "bytes": len(body.encode())},
        body,
    )


def main() -> int:
    results: list[dict[str, object]] = []
    failures: list[str] = []
    response_bodies: dict[str, str] = {}

    for name, url, required_fragments in CHECKS:
        try:
            result, body = check(name, url, required_fragments)
            results.append(result)
            response_bodies[name] = body
        except RuntimeError as error:
            failures.append(str(error))

    sitemap_body = response_bodies.get("sitemap", "")
    meeting_urls = sorted(
        {(match.group(1), match.group(0)) for match in MEETING_URL_PATTERN.finditer(sitemap_body)},
        reverse=True,
    )[:3]
    if not meeting_urls:
        failures.append("sitemap did not contain a dated horse-racing meeting URL")
    else:
        for meeting_date, meeting_url in meeting_urls:
            try:
                result, _ = check(
                    f"meeting-{meeting_date}",
                    meeting_url,
                    ("racecard", "mrc racing"),
                )
                results.append(result)
            except RuntimeError as error:
                failures.append(str(error))

    print(json.dumps({"checks": results, "failures": failures}, sort_keys=True))
    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
