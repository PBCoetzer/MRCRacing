# UI/UX Design Specification

Status: first-pass local product direction

## Visual Direction

- Premium South African sports analysis platform built around the supplied MRC Racing Tips logo.
- Primary palette comes directly from the logo: deep royal purple, gold/orange card outline, cyan card accent, bright red highlight, magenta purple, white lettering, and small green success accents.
- Typography uses Bungee for brand and display headings, Nunito Sans for readable interface text, and JetBrains Mono for odds, balances, timestamps, and metrics.
- Cards use an 8px casino-ticket style radius with gold/cyan accents.
- Backgrounds use the logo's purple grid language so every page feels connected to the brand.
- Homepage acts as a branded race and tipster command board rather than a generic template.

## Brand Tokens

- Deep purple: `#1e0c38`
- Purple: `#321652`
- Gold: `#ffb000`
- Cyan: `#00d4e7`
- Red: `#ff1735`
- Magenta: `#d327ff`

## Core UX Principles

- Public users must understand the product in under 30 seconds.
- Clients must see credit balance, locked tips, upcoming tips, and unlock costs quickly.
- Tipsters must see ROI, win rate, followers, verification status, and tip publishing status.
- Admins must get dense operational tables and status badges without marketing clutter.
- Responsible gambling and "not a bookmaker" messaging must remain visible.

## First Implemented Routes

- `/`
- `/about`
- `/pricing`
- `/faq`
- `/contact`
- `/responsible-gambling`
- `/privacy`
- `/terms`
- `/login`
- `/register`
- `/forgot-password`
- `/client`
- `/tipster`
- `/admin`

## Next UI Tasks

- Add real theme toggle.
- Add tip detail and unlock flow.
- Add admin CRUD tables with filters.
- Add payment checkout screens.
- Add tipster publishing forms.
- Add mobile screenshots to the research and testing folders.
