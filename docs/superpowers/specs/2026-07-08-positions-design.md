# Positions & Position Alerts — Plan 3b Design

## Summary

This is Plan 3b, following Plan 3a (auth, merged). Of the original "Plan 3"
scope (auth + positions + dashboard), this plan delivers positions and the
two position-scoped alert types (Take Profit, Exit Warning) as an API
surface — no web UI (Plan 3c).

**Scope note on Telegram delivery:** the original v1 spec envisioned
per-user Telegram linking as part of this plan. That's deferred. Per-user
linking requires *receiving* Telegram updates (detecting when a user hits
"Start" on the bot to learn their chat_id), which is architecturally
different from anything built so far — Plan 2's Telegram integration only
ever sends. Real linking wants a webhook, which wants a public URL, which
this project doesn't have until there's a deployed environment. So Plan 3b
delivers position alerts through Plan 2's existing single shared Telegram
chat (message text indicates which user/position triggered it), and true
per-user linking becomes its own plan once Plan 3c's dashboard gives users
an actual "connect Telegram" UI moment to justify building it properly.

## Goals

- Users can record a position ("I bought this") against any Solana token by
  mint address, whether or not the scanner has already discovered it.
- Take Profit and Exit Warning alerts fire against held positions,
  independent of whether the underlying token is currently trending in
  DexScreener's discovery feed — a position doesn't stop mattering just
  because it's no longer "hot."
- Users can close a position, which stops it from being monitored/alerted
  on, without losing the historical record.
- Reuse Plan 1/2's existing scoring, snapshot, and history infrastructure
  rather than duplicating logic for a second "kind" of token evaluation.

## Data Model

`positions` — one row per tracked position:

- `id` (uuid, pk)
- `user_id` (uuid, references `auth.users(id)`)
- `token_id` (uuid, references `tokens(id)`)
- `entry_price` (numeric, not null)
- `entry_market_cap` (numeric, not null) — captured from the live
  DexScreener lookup at position-creation time (using the same
  marketCap-or-fdv fallback established in Plan 1), not derived later from
  snapshot history.
- `amount` (numeric, nullable) — not used by any alert-triggering logic
  (Take Profit/Exit Warning are price-and-percentage based, not
  value-based); kept for future display purposes.
- `opened_at` (timestamptz, default now())
- `closed_at` (timestamptz, nullable) — null means open/actively monitored.
  Set (not deleted) when a user closes a position, preserving history.

`alerts` (Plan 2's existing table) gains two nullable columns:

- `user_id` (uuid, nullable, references `auth.users(id)`) — null for
  discovery alerts (still broadcast, unchanged from Plan 2), set for
  position alerts.
- `position_id` (uuid, nullable, references `positions(id)`) — null for
  discovery alerts, set for position alerts. This is also the cooldown
  scope for position alerts: `(position_id, alert_type)` rather than
  `(token_id, alert_type)`, since two different positions on the same token
  (different entry prices) can have genuinely different trigger points.

## API Surface

- `POST /api/positions` — body `{ mintAddress: string; entryPrice: number; amount?: number }`.
  If `mintAddress` isn't already in `tokens`, fetches it live from
  DexScreener and upserts it (reusing Plan 1's `upsertToken`) before
  creating the position. Captures `entry_market_cap` from that same live
  fetch. Requires auth (`getCurrentUser`, Plan 3a) — 401 if not logged in.
- `DELETE /api/positions/:id` — sets `closed_at`, doesn't delete the row.
  Requires the position belong to the calling user (401/403 otherwise).
- (No `GET /api/positions` in this plan — listing positions is a Plan 3c
  dashboard concern; this plan only needs create/close since there's no UI
  to list them in yet. `getCurrentUser`-gated write endpoints are enough to
  build and test against directly.)

## Position Alert Rules

Both reuse Plan 1's scoring engine output and Plan 2's snapshot-history
functions rather than introducing parallel logic:

**Take Profit** fires on any of:
- `currentPrice >= entryPrice * 2` (position up 100%)
- `currentMarketCap >= entryMarketCap * 2` (market cap hit 2x entry)
- volume declining while price still rising: `score.factors.volumeMomentum < 0 && pair.priceChange.h1 > 0`
  — the inverse of Plan 2's Volume Spike signal.

**Exit Warning** fires on any of:
- liquidity down 20% or more from the prior snapshot (same threshold and
  mechanism as Plan 2's Liquidity Danger, reusing `getPriorSnapshot`)
- price down 25% or more from the recorded local high (reusing
  `getLocalHighPrice`; a steeper threshold than discovery's Trend Break
  since this concerns an already-held position, not a discovery candidate)
- volume collapsing: `score.factors.volumeMomentum` sharply negative
  (mirrors Volume Spike's threshold, inverted)

## Monitoring Architecture

A new route, `POST /api/cron/positions`, separate from Plan 1/2's
`/api/cron/scan`. Position monitoring walks *open positions*
(`closed_at is null`), not *newly discovered candidates* — a fundamentally
different iteration pattern that doesn't belong bolted onto the discovery
scan loop, and can run on its own schedule independent of discovery scan
frequency.

For each open position:
1. Fetch the underlying token's live DexScreener pair data directly by
   mint address (`fetchTokenPairs`, reused from Plan 1).
2. Write a snapshot and score it (`mapPairToSnapshot`, `scoreToken`,
   `insertSnapshot`, `insertScore` — all reused from Plan 1 as-is). This
   means held positions accumulate their own price/liquidity history over
   time even if the scanner's trending scan never touches them again,
   which is exactly the history Exit Warning's local-high check needs.
3. Evaluate the two position alert rules using the position's
   `entry_price`/`entry_market_cap` plus `getPriorSnapshot`/
   `getLocalHighPrice` (Plan 2, reused as-is — these already operate
   per-`token_id`, no changes needed).
4. Cooldown-check by `(position_id, alert_type)`, insert the alert, and
   deliver to Plan 2's shared Telegram chat with the message text
   indicating which position (token symbol + which user, since the chat is
   currently shared) triggered it.

## Error Handling

- Same per-position isolation as Plan 1/2's per-candidate isolation: one
  position's processing failure (bad mint address, DexScreener error, a
  guard throwing) is caught, logged, and does not fail the whole tick.
- `POST /api/positions` with a mint address DexScreener can't find: 400,
  not a 500 — a bad/mistyped address is a client error, not a server fault.

## Testing

Same established patterns:
- DB-touching functions (positions CRUD, alerts table extension) tested
  against real local Postgres, no mocking of our own DB layer.
- Position alert rule evaluation as pure functions, unit-tested with
  fixtures, same pattern as Plan 2's `evaluateDiscoveryAlerts`.
- `/api/cron/positions` route tests mock DexScreener `fetch` and Telegram
  `fetch`, same pattern as Plan 1/2's route tests.
- Live end-to-end verification: create a real position via `POST
  /api/positions` against the real DexScreener API, run `/api/cron/positions`
  against real local Postgres and the real Telegram bot from Plan 2, confirm
  a snapshot/score gets written and (if conditions are met, possibly via a
  temporary threshold adjustment like Plan 2's live check) an alert is
  delivered.

## Out of Scope for Plan 3b

- Per-user Telegram linking — deferred to a future plan once Plan 3c's
  dashboard exists (see Scope Note above).
- Any web UI (position list, "add position" form, close button) — Plan 3c.
- `GET /api/positions` (listing) — not needed without a UI to list them in;
  added when Plan 3c needs it.
- Editing a position's entry price/amount after creation — not requested;
  close-and-recreate is the v1 workflow if a user made a mistake.
