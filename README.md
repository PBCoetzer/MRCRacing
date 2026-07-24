# MRC Website

MRC Website is a South African sports tipping platform project. The product will run locally first and is planned for production hosting on a Node.js-compatible provider with Supabase, PostgreSQL, Supabase Auth, and Supabase Storage.

## Current Status

- Workspace folders are created.
- A living project TODO exists in `TODO.md`.
- Initial competitor research and architecture documents are underway.
- The frontend app will live in `Frontend`.
- Supabase planning and schema files will live in `Database`.
- GitHub repository confirmed as `PBCoetzer/MRCRacing`.
- Supabase project confirmed as `MRCRacing`.
- Xneelo Volume Plan live-testing deployment is documented in `Deployment/GitHub Supabase Xneelo Plan.md`.

## Project Principles

- Document decisions before implementation.
- Keep local development safe, reproducible, and free from hard-coded secrets.
- Use a modular architecture for multiple sports, tipsters, payment gateways, and future subscription models.
- Treat credits as a wallet ledger, not as editable numbers without history.
- Keep premium betting tips behind role, credit, and audit controls.

## Main Stack

- Next.js
- React
- TypeScript
- TailwindCSS
- shadcn/ui
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage

## Source Of Truth

All project files, reports, decisions, schemas, screenshots, and guides must stay inside this root workspace:

`C:\Users\coetz\OneDrive\MRC Website`
