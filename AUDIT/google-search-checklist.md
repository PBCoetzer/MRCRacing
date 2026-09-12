# Google Search Readiness Checklist

## Automated Checks

- [x] HTTPS canonical host is stable.
- [x] Apex and HTTP redirect once to the canonical host.
- [x] Public sitemap is reachable.
- [x] Private routes are absent from the sitemap.
- [x] Private/Auth routes are disallowed in `robots.txt`.
- [x] Public routes return 200 and missing routes return 404.
- [x] Titles, descriptions, and canonical tags exist on crawled public routes.
- [x] JSON-LD is serialized without raw `<` injection.
- [ ] Sitemap static URLs do not redirect (`SEO-001`).
- [ ] Dynamic article/profile HTML contains visible H1 and body content (`SEO-002`).
- [ ] Client navigation is free of route-payload 404s (`SEO-003`).
- [ ] Performance meets agreed Core Web Vitals thresholds (`PERF-001`).

## Owner Actions In Google Search Console

- [ ] Verify both domain and canonical HTTPS properties.
- [ ] Submit `https://www.mrcracing.co.za/sitemap.xml`.
- [ ] Inspect the home page, one article, one tipster, and one race-meeting URL.
- [ ] Confirm private/Auth routes are not indexed.
- [ ] Review Page Indexing, Core Web Vitals, HTTPS, and structured-data reports after deployment.
- [ ] Request re-indexing only after the final production smoke test.

## Evidence Record

Store export dates and counts, not customer data or authentication tokens, when recording Search Console evidence.
