# Discovery Alerts & Telegram Delivery — Plan 2 Design

## Summary

This is Plan 2 of the v1 build (see `2026-07-08-meme-coin-radar-v1-design.md` for
full product context; Plan 1, `2026-07-08-scan-pipeline-scoring.md`, built the
scan/scoring pipeline this plan extends).

Plan 2 evaluates the four **discovery** alert rules (Buy Watch, Volume Spike,
Liquidity Danger, Trend Break) against every candidate the scan pipeline
already scores each tick, persists any that fire, and pushes them to a single
Telegram chat. No user accounts, no web UI — those come in Plan 3 alongside
**position** alerts (Take Profit, Exit Warning), which require a user's entry
price and therefore require auth to exist first. That split was decided
during Plan 1's brainstorming and reconfirmed at the start of this plan's
brainstorming.

## Goals

- Turn every scan tick's scored candidates into real, delivered alerts for
  the four discovery alert types, without inventing new scan infrastructure.
- Make the spec's vaguer alert definitions ("volume acceleration crosses a
  threshold," "price breaks below short-term support") concrete and
  implementable against the fields actually available from DexScreener and
  the scoring engine — see below.
- Don't lose an alert if Telegram delivery fails; don't spam the same alert
  repeatedly for the same token.

## Alert Trigger Definitions

Two of these map directly to fields already available from a single
`DexScreenerPair` fetch (no history needed). Two require querying that
token's stored `token_snapshots` history, since DexScreener doesn't expose
tick-over-tick liquidity change or a notion of "local high"/"support" — both
are refinements of the spec's original wording into something this pipeline
can actually compute, the same kind of grounding done for the scoring model
in Plan 1.

1. **Buy Watch** (no history needed): `marketCap < $5,000,000` AND
   `liquidity.usd >= $100,000` AND `volume.h1 >= $250,000` AND
   `priceChange.h1 > 0` AND buy/sell ratio favorable (`buys.h1 > sells.h1`).
2. **Volume Spike** (no history needed): reuses the scoring engine's existing
   `volumeMomentum` factor (Plan 1, `src/lib/scoring/score.ts`) rather than a
   second volume-acceleration calculation — fires when `volumeMomentum >= 15`
   (its max possible value is 20).
3. **Liquidity Danger** (needs prior snapshot): current `liquidity.usd` down
   20% or more versus that token's immediately prior `token_snapshots` row.
   A token with no prior snapshot (first tick it's ever been seen) cannot
   trigger this — there's nothing to compare against.
4. **Trend Break** (needs snapshot history): current `priceUsd` down 10% or
   more from `MAX(price_usd)` across that token's stored `token_snapshots`
   AND `priceChange.h1 < 0`. Same first-tick caveat as above.

## Data Model

New `alerts` table (Postgres, same local Supabase instance from Plan 1):

- `id` (uuid, pk)
- `token_id` (uuid, fk → `tokens.id`)
- `alert_type` (text — one of `buy_watch`, `volume_spike`, `liquidity_danger`, `trend_break`)
- `triggered_at` (timestamptz, default now())
- `payload` (jsonb — the score/factors/snapshot values at trigger time, for later debugging and backtesting; never re-derived after the fact)
- `telegram_sent` (boolean, default false)
- `telegram_error` (text, nullable)

## Cooldown / Dedupe

Before inserting a new alert, check whether the same `(token_id, alert_type)`
pair already has a row in `alerts` with `triggered_at` within the last 30
minutes (per the spec). If so, skip — no new row, no Telegram message.

## Delivery

A single Telegram chat via the Bot API's `sendMessage` endpoint, using
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars. Manual setup steps
(creating the bot via @BotFather, obtaining the token, finding the target
chat ID) are the first task in the implementation plan, since this is a
one-time prerequisite the plan can't automate.

On send failure: log it, set `telegram_sent = false` and `telegram_error` on
the already-inserted alert row, and do not retry-loop — matches the parent
spec's error-handling stance ("best-effort, not a real-time guarantee"). The
alert is persisted regardless of whether Telegram delivery succeeds, so nothing
is lost to a transient Telegram outage; it's just not delivered live.

## Architecture

Extends the existing `/api/cron/scan` route (Plan 1) rather than adding a
second cron job or a separate pipeline. Within the same per-candidate loop,
immediately after `insertScore`, the route:

1. Fetches the token's prior snapshot and local-high price (two small
   queries against `token_snapshots`, scoped to that one token).
2. Evaluates the four alert rules against the current snapshot/score plus
   that history.
3. For any rule that fires and isn't in cooldown, inserts an `alerts` row
   and sends the Telegram message.

This keeps everything in one tick, one route, one place that has to reason
about DexScreener's rate limit — no new scheduling infrastructure, and no
duplicated candidate-fetching logic.

## Testing

- **Alert rule evaluation**: pure functions taking the current
  snapshot/score plus a plain "history" object (prior snapshot, local high)
  as input — unit tested with fixtures, same pattern as Plan 1's scoring
  engine tests. No DB or network access required to test the rule logic
  itself.
- **Telegram client**: a thin `sendTelegramMessage` wrapper, tested with a
  mocked `fetch`, same pattern as Plan 1's DexScreener client tests.
- **Cooldown logic**: tested against the real local Postgres instance, same
  pattern as Plan 1's DB access layer tests (Task 3) — insert a prior alert
  row, assert a second evaluation within the cooldown window doesn't fire.
- **Route integration**: extends Plan 1's `route.test.ts` pattern (mocked
  `fetch` for DexScreener + Telegram, real local Postgres for everything
  else) to assert alerts land in the `alerts` table and the Telegram client
  is called with the expected payload for a candidate that should fire.

## Out of Scope for Plan 2

- Position alerts (Take Profit, Exit Warning) — deferred to Plan 3, which
  also introduces auth and the `positions` table these alerts require.
- Any web UI (discovery feed, alerts page) — deferred to Plan 3 so all
  dashboard pages get built together as one coherent surface, rather than
  splitting frontend work across two plans.
- Per-user Telegram linking / multiple destination chats — Plan 2 delivers
  to one fixed chat via env vars; per-user chat linking is a Plan 3 concern
  once accounts exist.
- Alert threshold tuning/backtesting — thresholds here are the same
  starting-hypothesis values from the parent design spec, not yet validated
  against historical data.
