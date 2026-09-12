# Performance Audit

## Lighthouse Baseline

| Route | Performance | Accessibility | Best practices | SEO | LCP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Home | 77 | 96 | 96 | 100 | 6.8 s |
| Pricing | 76 | 100 | 96 | 100 | 7.4 s |
| Login | 68 | 100 | 96 | 61* | 10.0 s |

`*` Login is intentionally non-indexable, which lowers the Lighthouse SEO score.

## Local Remediation Benchmark

| Route | Performance | Accessibility | Best practices | SEO | LCP | Estimated unused JS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | 93 | 100 | 100 | 100 | 3.27 s | 87 KiB |
| Pricing | 94 | 100 | 100 | 100 | 3.02 s | 89 KiB |
| Login | 94 | 100 | 100 | 69* | 3.02 s | 91 KiB |
| Horse care | 91 | 100 | 100 | 100 | 3.46 s | 89 KiB |

Measured against the local production export on 2026-09-13. Lighthouse reported a Windows temporary-profile cleanup error after writing each valid JSON report; report generation and scores completed.

## PERF-001 — Largest Contentful Paint is slow

| Field | Value |
| --- | --- |
| Severity | High |
| Area | Web performance |
| Problem | Sampled LCP ranges from 6.8 to 10.0 seconds, well above a good-user-experience target. |
| Impact | Slow visible loading harms mobile conversion, trust, and search experience. |
| Redacted evidence | Live mobile Lighthouse runs on home, pricing, and login. TBT and CLS were low, isolating asset/network/render cost as the main issue. |
| Object | Public and Auth route bundles/assets |
| Recommended fix | Reduce initial client JavaScript, optimize priority media, avoid unnecessary prefetch failures, and retest on representative mobile throttling. |
| Verification | Mobile Lighthouse LCP under 2.5 seconds where practical and no regression above the agreed budget. |
| Status | Mitigated locally; performance improved from 68–77 to 91–94 and LCP from 6.8–10.0 seconds to 3.0–3.5 seconds. The 2.5-second target is not yet met and must be retested on deployed hosting. |

## PERF-002 — Oversized priority hero image

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Image delivery |
| Problem | The horse-care priority hero PNG is 1,820,686 bytes and static export disables Next image optimization. |
| Impact | Mobile visitors download substantially more bytes than required before the primary visual completes. |
| Redacted evidence | `echcu-horse-care-hero.png` is 1.78 MiB and used with `priority` and `sizes="100vw"`. |
| Object | `Frontend/public/images/echcu-horse-care-hero.png`, horse-care page metadata |
| Recommended fix | Produce a visually verified WebP/AVIF derivative, update page and social metadata references, and retain the source only if operationally required. |
| Verification | Byte comparison, image dimensions/quality review, and Lighthouse image-delivery audit. |
| Status | Fixed locally in `5e4eaeb`; the page now loads an 84,870-byte 1672×941 WebP instead of the 1,820,686-byte PNG, a 95% reduction. The original remains only for social metadata compatibility. |

## PERF-003 — Excessive client-side JavaScript

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Rendering architecture |
| Problem | Lighthouse estimates 453–767 KiB of unused JavaScript, and the active frontend contains 48 client components including several very large dashboard modules. |
| Impact | Longer download, parse, and hydration work slows mobile navigation and makes failures harder to isolate. |
| Redacted evidence | Live Lighthouse unused-JS audits and source inventory. |
| Object | `Frontend/src/components`, route-level client boundaries |
| Recommended fix | Server-render public content, lazy-load heavy admin/tipster panels, and split large workspaces by active tab. |
| Verification | Bundle analysis, route-level transfer budget, and repeated Lighthouse runs. |
| Status | Substantially mitigated locally; estimated unused JavaScript is now 87–91 KiB on sampled routes. Further dashboard splitting remains a staged optimization. |
