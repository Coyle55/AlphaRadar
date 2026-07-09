# Watchlist / Positions UI — Design

## Summary

Plan 3b built the positions API (log a position, close a position, position
alerts) with no UI in front of it. This plan adds that UI: a `/positions`
page where a logged-in user can see their open and closed positions, log a
new one, and close an existing one — the first place in the product where a
user's own trading activity, not just market-wide scan data, is visible.

## Goals

- A logged-in user can see all their open positions with live current price
  and P&L, and their closed positions with realized P&L.
- A user can log a new position (mint address + their actual entry price +
  optional amount) without leaving the page.
- A user can close an open position with their actual exit price, producing
  real, storable P&L history — not just a timestamp.

## Data & Backend Changes

### Migration

`positions` gains two nullable columns:

```sql
alter table positions add column exit_price numeric;
alter table positions add column exit_market_cap numeric;
```

Nullable because every existing/open position has neither yet, and open
positions never will until closed.

### Closing a position now requires an exit price

`DELETE /api/positions/[id]` (Plan 3b, currently just stamps `closed_at`)
is extended to require a JSON body: `{ exitPrice: number }`. On close, the
route does a live DexScreener lookup for the token's current pair (same
`fetchTokenPairs` + `selectPair` + `getEffectiveMarketCap` pattern
`POST /api/positions` already uses for `entryMarketCap`) to compute
`exitMarketCap`, then stores `exit_price`, `exit_market_cap`, and
`closed_at` together. `exitPrice` is user-entered — symmetric with how
`entryPrice` already works today (a real fill price, not necessarily
today's displayed price, since real trades have slippage) — while
`exitMarketCap` is auto-fetched for context, exactly like `entryMarketCap`
already is.

The existing authorization check (only the position's owner may close it)
and not-found handling are unchanged.

### New read functions

Two new functions in `src/lib/db/positions.ts`, both consumed directly by
the `/positions` Server Component — no new GET API route, same convention
established by the discovery feed and Coin Detail page (nothing else needs
to read this data yet, so a same-origin API round-trip would be pure
overhead):

- `getOpenPositionsForUser(userId)` — a user's open positions, each joined
  with the token's symbol/name and its **latest snapshot regardless of
  age** (unfiltered by recency — same choice Coin Detail made, since a
  position's token may have aged out of the discovery feed's 2-hour window
  but should still show whatever price we last saw). If the token has zero
  snapshots ever, current price and P&L render as `—`, not an error —
  same defensive handling as Coin Detail's "token exists but never
  scanned" case.
- `getClosedPositionsForUser(userId)` — a user's closed positions, joined
  with token symbol/name, returning the stored `exitPrice`/`exitMarketCap`
  so realized P&L is computed from frozen entry/exit data, not live price.

## Page

- `/positions`, inside the existing `(app)` route group — inherits the
  protected layout's auth gate automatically, no separate check needed
  (same as Coin Detail).
- A new "Positions" link added to the header nav, next to the wordmark —
  primary navigation, distinct from the `AccountMenu` dropdown (which
  stays account-only: email + logout).
- **Log Position**: a collapsible "+ Log Position" disclosure at the top
  of the page (closed by default, so the page stays dense) revealing a
  form — mint address, entry price, optional amount — posting to the
  existing `POST /api/positions`. On success, the form collapses and the
  page refreshes to show the new open position.
- **Open Positions**: a table — token (symbol/name), entry price, current
  price with a "last scanned {time ago}" note beneath it, live P&L%
  (color-coded `signal-green`/`signal-red`), amount (if provided), opened
  date, and a "Close" action. Clicking Close expands an inline exit-price
  input in that row (no modal, no separate page) with a confirm button;
  submitting posts to the extended `DELETE /api/positions/[id]` and
  refreshes the page on success.
- **Closed Positions**: a table — token, entry price, exit price, realized
  P&L% (color-coded the same way), opened date, closed date.
- Empty states: "No open positions yet — log one above" / "No closed
  positions yet" instead of blank tables.
- No new colors, fonts, or signature elements — reuses the existing dark
  terminal design tokens exactly as they exist today. All numeric data in
  `font-mono`. This page is straightforward reuse of already-established
  visual patterns (dense tables, inline forms, signal-colored P&L), not a
  new visual surface, so it doesn't need a fresh design pass the way Coin
  Detail's chart and score-breakdown did.

## Error Handling

- Log-position form errors (invalid/unknown mint, no market data yet)
  surface inline, reusing `POST /api/positions`'s existing error response
  bodies — no new error copy needed there.
- The inline close form validates the exit price is a positive number
  client-side before submitting; server-side errors (e.g. a DexScreener
  lookup failure at close time) surface inline in that row.
- A token with no snapshot history shows `—` for current price and P&L in
  the open positions table rather than blank/broken cells.

## Testing

- `getOpenPositionsForUser` and `getClosedPositionsForUser` tested against
  real local Postgres: a user with no positions, an open position with a
  snapshot (P&L computable), an open position with zero snapshots (`—`
  case), a closed position with realized P&L, and confirming positions are
  correctly scoped to the requesting user (a second user's positions never
  appear).
- The extended `DELETE /api/positions/[id]` tested: missing/invalid
  `exitPrice` returns 400, successful close stores `exit_price` and
  `exit_market_cap` correctly, the existing ownership/not-found checks
  still pass.
- The page itself verified live via the dev server — this project has no
  browser-automation tooling, so (consistent with the last two plans) this
  means curl-based structural verification of the log/close flows against
  real endpoints, not literal visual browser checks.

## Out of Scope

- Editing or deleting a logged position after the fact.
- Partial closes (selling only part of a position's `amount`).
- Any charting of a position's price history over its holding period.
- A "Log this position" CTA on the Coin Detail page pre-filling the mint
  address — a natural follow-up, not required for this plan to be useful
  on its own.
