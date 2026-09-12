# SEO Audit

## Verified

- Canonical host redirects are consistent to `https://www.mrcracing.co.za`.
- Custom missing pages return HTTP 404.
- `robots.txt` excludes Auth, payment-status, client, tipster, and admin workspaces.
- The sitemap excludes private routes.
- All 43 crawled sitemap URLs resolve to 200 and include title, description, and canonical metadata.
- Organization, WebSite, BlogPosting, Person, and Breadcrumb structured data are emitted where relevant.

## SEO-001 — Static sitemap URLs redirect

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Canonical consistency |
| Problem | Static sitemap entries omit trailing slashes while page canonicals and hosting redirects use trailing slashes. |
| Impact | Crawlers spend budget following avoidable redirects and receive inconsistent URL signals. |
| Redacted evidence | Static entries are built as `${canonicalSiteUrl}${path}`; dynamic entries already include `/`. |
| Object | `Frontend/src/app/sitemap.ts` |
| Recommended fix | Emit a trailing slash for every non-root static route and validate sitemap URLs are redirect-free. |
| Verification | Crawl sitemap and require zero redirects and canonical equality. |
| Status | Fixed locally in `f4437d3`; every local sitemap URL includes the canonical trailing slash. All 43 resulting URLs return direct HTTP 200 responses from the current host with title and canonical metadata. Production sitemap deployment pending. |

## SEO-002 — Dynamic articles and profiles lack server-rendered primary content

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Rendered content and crawlability |
| Problem | Blog and tipster server pages fetch content for metadata/JSON-LD but render client components that start empty and refetch after hydration. Four sampled live pages had no H1 in initial HTML. |
| Impact | Search engines, link unfurlers, and no-JavaScript clients can receive metadata without the visible article/profile content. |
| Redacted evidence | Two blog and two tipster pages lacked server HTML H1; client components initialize with `null`. |
| Object | `Frontend/src/app/blog/[slug]/page.tsx`, `Frontend/src/app/tipsters/[slug]/page.tsx` and their client components |
| Recommended fix | Pass the server-fetched record as initial client state or server-render the public heading/content. |
| Verification | Built HTML contains the expected H1 and primary text before JavaScript. |
| Status | Fixed locally in `f4437d3`; the export verifier confirms server-rendered H1 content for two blog articles and two tipster profiles before JavaScript. Production deployment pending. |

## SEO-003 — Static RSC prefetch aliases return 404

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Navigation and crawl quality |
| Problem | Live navigation attempts fetch underscore-safe Next route payload aliases that return 404 for several routes. |
| Impact | Client navigation can fall back to slower full-page loads and produces noisy errors that obscure real failures. |
| Redacted evidence | Browser console recorded 404s for horse-racing, tipsters, register, and forgot-password payload files. |
| Object | `Frontend/scripts/prepare-static-export.mjs`, Xneelo deployment artifact |
| Recommended fix | Repair the static-export validator and assert every generated route payload alias exists before packaging. |
| Verification | Browser navigation has no RSC 404s; artifact check passes. |
| Status | Fixed locally in `f4437d3`; 63 flattened route-payload aliases are generated and verified, and local browser navigation returned HTTP 200 without payload 404s. Production deployment pending. |
