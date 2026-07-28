# MRC Website TODO

This TODO is the operating checklist for the MRC Website build. Every completed item should point to source code, documentation, research notes, screenshots, or test evidence inside this workspace.

## 1. Workspace Foundation

- [x] Create the `MRC Website` root workspace.
- [x] Create source-of-truth folders for research, planning, documentation, design, frontend, backend, database, API, testing, deployment, assets, and notes.
- [x] Add a project README with local setup instructions.
- [x] Add decision logs for major architecture choices.
- [x] Add an environment variable template with safe placeholders only.

## 2. Competitor Research

- [x] Research `https://racevolt.co.za`.
- [x] Research `https://thedailypunterclub.co.za/`.
- [ ] Capture screenshots for homepage, navigation, auth, pricing, tips, and mobile layouts where accessible.
- [x] Document navigation, user journey, business model, UI/UX, payments, tip presentation, sports coverage, SEO, performance, and security observations.
- [x] Produce a competitor analysis report with opportunities for MRC Website to improve.

## 3. Industry Research

- [x] Research sports tipping platform best practices.
- [ ] Research South African betting community expectations.
- [ ] Research POPIA, responsible gambling, and payment security requirements.
- [x] Research credit wallet and subscription models.
- [x] Research leaderboard, ROI, win-rate, and ranking models for tipsters.
- [x] Produce an industry research report.

## 4. Architecture Planning

- [x] Define the full system architecture.
- [x] Document frontend, backend, database, auth, payment, credit, admin, and deployment flows.
- [x] Choose the state management approach.
- [x] Define role and permission boundaries for client, tipster, and administrator.
- [x] Document all architecture decisions before implementation.

## 5. Frontend Application

- [x] Scaffold a Next.js, React, TypeScript, TailwindCSS, and shadcn/ui application.
- [x] Build the public layout, navigation, theme system, and responsive shell.
- [ ] Build public pages: Home, About, Pricing, FAQ, Contact, Responsible Gambling, Privacy Policy, Terms, Login, Register, Forgot Password.
- [ ] Build client dashboard pages: Credits, Purchased Tips, Upcoming Tips, History, Notifications, Payments, Profile, Settings.
- [ ] Build tipster dashboard pages: Dashboard, Manage Tips, Performance, Statistics, Followers, Earnings, History, Profile.
- [ ] Build admin dashboard pages: Dashboard, Users, Tipsters, Sports, Fixtures, Results, Credits, Transactions, Subscriptions, Payments, Announcements, Reports, Audit Logs, Settings, API Configuration.
- [ ] Ensure desktop and mobile layouts are polished and accessible.

## 6. Supabase Backend

- [x] Add Supabase project integration configuration.
- [x] Create database schema documentation.
- [x] Create a schema baseline for roles, profiles, tipsters, sports, fixtures, tips, results, wallets, credits, transactions, payments, subscriptions, announcements, notifications, audit logs, and media.
- [x] Apply the baseline schema to the Supabase project `MRCRacing`.
- [x] Add Auth user bootstrap for profiles, wallets, and default client role.
- [ ] Convert schema baseline into Supabase CLI migrations.
- [x] Enable Row Level Security on exposed tables.
- [x] Add role-aware RLS policies.
- [ ] Add Supabase Auth flows for registration, login, email verification, password reset, and protected dashboards.
  - [x] Connect login, registration, password reset, and admin access checks to Supabase.
  - [x] Protect client and tipster dashboards with live session checks.
- [ ] Add Supabase Storage strategy for tipster images and media.

## 7. Credit And Payment System

- [x] Design wallet balance and immutable transaction ledger tables.
- [ ] Research PayFast, Ozow, Peach Payments, PayGate, Yoco, and Instant EFT.
- [ ] Compare fees, webhook support, refunds, sandbox support, API quality, and security.
- [ ] Design a payment gateway adapter architecture.
- [ ] Implement local mock payment flows for development.
- [ ] Document production payment setup.

## 8. Sports Data

- [ ] Research APIs for horse racing, soccer, rugby, cricket, tennis, UFC, boxing, greyhound racing, fixtures, live scores, race cards, and historical results.
- [ ] Compare pricing, licensing, rate limits, update frequency, reliability, and response speed.
- [ ] Recommend production data providers.
- [ ] Implement local sample data for fixtures and results.
- [ ] Design API integration points for production providers.

## 9. Security

- [ ] Document the security model.
- [ ] Use environment variables for all secrets and configuration.
- [ ] Add input validation for forms and API routes.
- [ ] Protect premium tips behind credit checks.
- [ ] Add role checks for dashboards and admin tools.
- [ ] Add audit logging for sensitive actions.
- [ ] Review XSS, CSRF, SQL injection, auth, RLS, and payment webhook risks.

## 10. Testing And Review

- [x] Add linting and formatting scripts.
- [ ] Add focused tests for critical business logic.
- [x] Verify local build and startup.
- [ ] Review architecture, frontend, backend, database, security, accessibility, mobile, performance, SEO, API reliability, and scalability.
- [x] Document every review cycle in `Testing`.
- [ ] Fix meaningful issues found during review.

## 11. Final Deliverables

- [ ] Competitor Analysis.
- [ ] Industry Research Report.
- [ ] System Architecture.
- [x] UI/UX Design Specification.
- [ ] Database Schema Documentation.
- [ ] API Evaluation Report.
- [ ] Payment Gateway Evaluation.
- [x] Security Assessment.
- [x] Testing Report.
- [x] Local Development Guide.
- [x] Production Deployment Guide.
- [ ] Future Roadmap.
- [ ] Complete local source code.

## 12. Tipster Meeting Cards

- [x] Add normalized meetings, runners, betting legs, cards, selections, packages, purchases, subscriptions, entitlements, earnings, disputes, and notification outbox tables.
- [x] Add authenticated publication, revision, purchase, subscription, refund, and dispute RPCs.
- [x] Add optimistic card revisions, race and meeting-bet locks, automatic one-off refunds, commission snapshots, and immutable earnings reversals.
- [x] Add private Greyville test meeting data with future synthetic times and source attribution.
- [x] Add live tipster card editor for winners, places, comments, PA, Pick 6, Bipot, Jackpots, and Other bets.
- [x] Add client meeting marketplace, subscriptions, premium entitlement view, purchases, and disputes.
- [x] Add admin user roles, tipster verification, test access, wallet adjustment, commission, disputes, refunds, and notification operations.
- [x] Deploy the Supabase notification Edge Function with Resend-ready branded templates.
- [x] Verify static build, critical RLS personas, idempotent purchases, subscriptions, refunds, dispute reversals, revisions, and notification queue insertion.
- [ ] Configure the production `RESEND_API_KEY` Edge Function secret and complete a real delivery test.
- [ ] Replace the private Raceform clone with the licensed authoritative racing API feed.
