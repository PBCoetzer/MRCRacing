# Accessibility Audit

## Verified

- Lighthouse accessibility scores were 96–100 on sampled public/Auth routes.
- Shared dialogs use Radix focus trapping, labeled titles/descriptions, Escape handling, and focus restoration.
- Shared alerts expose `role="alert"`.
- Forms sampled use associated labels and disabled/busy states.
- Table containers permit horizontal scrolling rather than clipping at the component level.
- Final local Lighthouse accessibility scores are 100 on home, pricing, login, and horse-care routes.

## A11Y-001 — Home live-status badge contrast fails

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Color contrast |
| Problem | The white text on the red “Live database” badge measures approximately 3.87:1, below the 4.5:1 target for normal text. |
| Impact | Users with low vision may struggle to read the status label. |
| Redacted evidence | Lighthouse contrast audit on the live home page. |
| Object | `Frontend/src/app/page.tsx` |
| Recommended fix | Use a darker red surface or dark foreground with sufficient contrast while preserving brand intent. |
| Verification | Automated contrast audit and visual review. |
| Status | Fixed locally in `5e4eaeb`; the badge uses a darker red surface and the final Lighthouse contrast audit passes. |

## A11Y-002 — Authenticated journeys lack repeatable automated coverage

| Field | Value |
| --- | --- |
| Severity | Medium |
| Area | Accessibility regression testing |
| Problem | No automated keyboard/axe coverage exists for client card acceptance, tipster editing, admin dialogs, purchases, or refund approval. |
| Impact | Regressions in focus order, names, errors, or touch targets can reach production unnoticed. |
| Redacted evidence | No browser test configuration or CI workflow exists. |
| Object | Authenticated frontend journeys |
| Recommended fix | Add browser accessibility smoke tests at mobile and desktop sizes using non-production test identities. |
| Verification | CI produces zero serious/critical axe violations and completes keyboard-only flows. |
| Status | Partially remediated; four local public/Auth Lighthouse runs score 100, and manual mobile/desktop browser smoke covered the authenticated tipster card list and navigation. Repeatable authenticated axe and keyboard flows remain blocked on a synthetic non-production identity environment. |
