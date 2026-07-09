# Alerts Page — Design

## Summary

Every alert this product fires (discovery signals from Plan 2, position
alerts from Plan 3b) has only ever gone to Telegram. This plan adds a
`/alerts` page showing that same history inside the product itself — the
last of the four pages from the original dashboard scope (Auth UI +
Discovery Feed, Coin Detail, Watchlist, and now Alerts).

## Goals

- A logged-in user can see a chronological history of fired discovery
  alerts (global — the scanner's signals, not tied to any one user).
- A logged-in user can see a chronological history of their own position
  alerts (personal — take-profit/exit-warning on positions they hold).
- Alerts read this history at trigger-time fidelity: price and liquidity
  as they were when the alert fired, not live/current values.

## Data & Page

- `/alerts`, inside the existing `(app)` route group — inherits the
  protected layout's auth gate automatically, same as Coin Detail and
  Watchlist.
- A new "Alerts" link added to the header nav, alongside the existing
  "Discovery"/"Positions" links.
- Two new functions in `src/lib/db/alerts.ts`, both consumed directly by
  the Server Component page — no new API route, same convention every
  read-only page in this product has used:
  - `getDiscoveryAlerts()` — the most recent 50 alerts where
    `user_id is null` (Plan 2's discovery alerts are fired for the token
    generally, not for any specific user), joined with the token's
    `symbol`/`name`/`mint_address`, ordered by `triggered_at` descending.
  - `getPositionAlertsForUser(userId)` — the most recent 50 alerts where
    `user_id = $1`, joined with the token's `symbol`/`name`, ordered by
    `triggered_at` descending.
- Both functions read directly from `alerts.payload` (already stores the
  full `{ score, pair }` snapshot at trigger time — no live DexScreener
  lookup needed, and no drift between what the alert said and what the
  page shows).
- The page has two sections, mirroring the Open/Closed split already
  established on the Watchlist page:
  - **Discovery Alerts** — the global feed. Every authenticated user
    sees the same one; it's market-wide signal history, not personal
    data (same "public to any authenticated user" model the discovery
    feed and Coin Detail already use).
  - **Your Position Alerts** — personal, scoped strictly to the
    requesting user. This is the second genuinely per-user-scoped read
    in the app (after Watchlist's open/closed positions), so cross-user
    isolation gets the same test scrutiny that plan required.
- Each row shows: a color-coded type tag (reusing `ALERT_LABELS` from
  `src/lib/alerts/format.ts` — no new label copy needed), token
  symbol/name, price and liquidity as captured in the alert's payload at
  trigger time, and how long ago it fired (reusing `timeAgo` from
  `src/lib/format.ts`).
- Discovery alert rows link to `/token/{mintAddress}` (Coin Detail) —
  reasonable now that Coin Detail exists, ties the alert back to the
  token's current full picture. Position alert rows are plain, unlinked,
  for this plan — there's no per-position deep link target yet.
- Color coding reuses the existing `signal-green`/`signal-red` tokens,
  mapped by alert severity: `buy_watch`, `volume_spike`, and
  `take_profit` render green (opportunity signal / positive outcome);
  `liquidity_danger`, `trend_break`, and `exit_warning` render red
  (risk signal / negative outcome). This is a direct extension of the
  same signal-direction semantics these tokens already carry for
  price/P&L — not a new, unrelated use of them. No new colors are
  introduced anywhere in this plan.

## Error Handling

Empty states for both sections — "No discovery alerts yet" / "No
position alerts yet" — instead of blank tables, matching every other
page's convention in this product.

## Testing

- `getDiscoveryAlerts()` and `getPositionAlertsForUser()` tested against
  real local Postgres: ordering (most recent first), the 50-row cap,
  and — the one property worth extra scrutiny, same as Watchlist's
  per-user reads — confirming `getPositionAlertsForUser` never returns
  another user's alerts, and confirming `getDiscoveryAlerts()` never
  includes a `user_id`-scoped (position) alert.
- The page itself verified live via curl against the real dev server —
  this project has no browser-automation tooling, same adaptation used
  in every UI plan so far.

## Out of Scope

- Marking alerts as read/unread.
- Filtering the feed by alert type.
- Real-time/push updates (the page is a server-rendered snapshot on
  load, same as every other page in this product).
- Alert preferences, muting, or per-user notification settings.
