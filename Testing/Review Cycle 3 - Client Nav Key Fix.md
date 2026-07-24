# Review Cycle 3 - Client Nav Key Fix

Date: 24 July 2026

## Issue

Clicking the Client tab showed a React console warning:

`Encountered two children with the same key, /client.`

## Cause

Dashboard sidebar items used `item.href` as the React key. Client, tipster, and admin placeholder nav items intentionally share the same dashboard route, which created duplicate keys.

## Fix

Dashboard nav keys now combine `href` and `label`, making each sidebar item unique while the placeholder routes remain unchanged.

## Tests

- `npm run lint`
- `npm run build`
- HTTP check for `/client`

## Status

Passed.
