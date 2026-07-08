# AlphaRadar (Meme Coin Radar) — v1 Design

## Summary

A SaaS product that scans new/trending Solana meme coin launches, scores them
on market-data signals, and alerts users (dashboard + Telegram) to
high-momentum candidates and exit risk. The product never issues a "buy this"
instruction — it always presents a candidate plus an explicit risk framing
(entry zone, stop level, take-profit levels, red flags), on the premise that
users understand this isn't foolproof.

v1 is intentionally scoped to **market data only** (DexScreener). On-chain
wallet/holder behavior, social signals, and auto-detected positions are
deferred — see Out of Scope.

## Goals

- Validate that a market-data-only scoring model can meaningfully separate
  promising launches from noise/rugs.
- Ship a real SaaS surface (dashboard with auth) from day one, not just a bot.
- Deliver alerts where this audience actually is (Telegram), not just in-app.
- Keep v1 buildable solo, part-time, without new infra beyond Vercel +
  Supabase + an external cron trigger.

## Architecture

Single Next.js app (App Router) deployed on Vercel:

- **Frontend**: dashboard pages (see below), calling internal API routes.
- **API routes**: standard CRUD for watchlist/positions/settings, plus:
  - `/api/cron/scan` — protected route, invoked every 1-5 min by an external
    scheduler (Upstash QStash or cron-job.org). Runs the full scan pipeline.
  - `/api/telegram/webhook` — receives Telegram bot updates (chat_id capture
    on `/start` deep link).
- **Database**: Postgres via Supabase.
- **No separate worker service in v1.** The scan pipeline is scoped tightly
  (trending/new pairs + active watchlists only, not the full chain) to fit
  inside a single serverless invocation. This is a deliberate, contained seam:
  if/when the scan job outgrows a single function, it can be lifted into a
  standalone Node service (Railway/Fly.io) without touching the rest of the
  app, because it's already isolated behind one route.

This was chosen over (a) a separate long-running worker service from day one
— more resilient but a second deployable to manage before it's earned its
keep — and (b) Supabase Edge Functions/pg_cron — minimal extra infra but
puts core business logic in a Deno runtime that's a less familiar debugging
environment.

## Data Model (Postgres)

- `users` — auth identity, Telegram `chat_id` (nullable until linked),
  subscription tier.
- `tokens` — mint address, symbol, name, pair address, first-seen timestamp.
- `token_snapshots` — one row per scan tick per token: price, liquidity,
  1h/24h volume, buy/sell tx counts, market cap, timestamp.
- `token_scores` — computed score + per-factor breakdown, linked to a
  snapshot.
- `positions` — `user_id`, `token_id`, entry_price, amount (optional),
  entry_timestamp. Created via manual "I bought this" action — no wallet
  linking in v1.
- `alerts` — type, token_id, `user_id` (null for broadcast discovery
  alerts), triggered_at, payload, delivered-channel flags.

## Ingestion & Scan Pipeline

Runs on every `/api/cron/scan` invocation (every 1-5 min):

1. Fetch DexScreener trending + new-pairs listings for Solana.
2. Hard-filter candidates (minimum liquidity, minimum age, minimum volume) to
   cut launch volume (pump.fun alone produces roughly 10-20k new tokens/day)
   down to a workable set before any scoring happens.
3. Write a `token_snapshots` row per surviving candidate; compute and store
   `token_scores`.
4. Evaluate **discovery alert rules** (Buy Watch, Volume Spike, Liquidity
   Danger, Trend Break) against the full candidate set. These are broadcast —
   not tied to a specific user's holdings.
5. Evaluate **position alert rules** (Take Profit, Exit Warning) only against
   tokens present in any user's `positions` table.
6. Dedupe/cooldown: the same alert type on the same token does not refire
   within a cooldown window (e.g. 30 min), to avoid spamming the same signal
   every tick.

Discovery alerts and position alerts are architecturally distinct: discovery
runs against everything the scanner sees, position alerts only run against
tokens a user has explicitly told the app they hold.

## Scoring Model (v1, market-data only)

Positive factors:
- Volume acceleration (current 1h volume vs. prior 1h)
- Liquidity growth (current liquidity vs. liquidity at first-seen)
- Price strength (short-term trend / above VWAP-equivalent)
- Buy/sell ratio (from DexScreener tx counts)
- Market cap within a target band (avoids both illiquid noise and coins
  whose momentum has likely already played out)

Negative factors:
- Low absolute liquidity
- Large wick/rejection candle
- Volume fading across consecutive snapshots
- Market cap outside the target band

Deferred to v2 (require on-chain/social data not in scope for v1): holder
growth, top-holder concentration, dev wallet selling, verified socials.

**The initial factor weights are a starting hypothesis, not a validated
model.** Before this scoring is shown to paying users, it must be backtested
against a pulled sample of historical DexScreener data covering known rugs
and known runners, to confirm the formula actually separates them. This
backtest is a required pre-launch step, not an assumed property of the
formula.

## Alert Triggers (v1)

Thresholds below are system defaults for v1 — not user-configurable yet
(per-user configurable thresholds are a natural v1.1 feature, intentionally
deferred to keep v1 scope down).

**Discovery alerts** (evaluated against all scanned candidates):
- *Buy Watch*: market cap < $5M, liquidity > $100k, 1h volume > $250k, price
  above short-term trend, favorable buy/sell ratio.
- *Volume Spike*: volume acceleration crosses a defined threshold vs. rolling
  baseline.
- *Liquidity Danger*: liquidity drops sharply tick-over-tick (LP-pull
  signature).
- *Trend Break*: price breaks below short-term support level.

**Position alerts** (evaluated only against a user's held tokens):
- *Take Profit*: position up 100%, OR market cap hits 2x entry-time market
  cap, OR volume declining while price is still rising.
- *Exit Warning*: liquidity drops, OR price down 20-30% from local high, OR
  volume collapses. (The "top wallet sells" variant from the original concept
  is dropped for v1 — it requires wallet-behavior data out of scope here.)

All output is framed as a candidate + risk profile, never an instruction:
"High-momentum candidate. Risk: extreme. Suggested plan: entry zone / stop
level / take-profit levels / red flags." The product never says "buy this."

## Frontend Pages

- **Discovery feed** — ranked list of currently-scored trending/new tokens,
  filterable by score/alert type. The default home screen.
- **Coin detail** — score breakdown, price chart, and the generated thesis
  block (entry zone / stop / take-profit levels / red flags).
- **Watchlist** — tokens the user is tracking, with an "I bought this" action
  that creates a `positions` row.
- **Alerts page** — chronological feed of everything fired for this user
  (discovery matches relevant to their watchlist + their position alerts).
- **Settings** — Telegram link flow, subscription/billing.

## Delivery

- **Telegram**: user starts the bot via a deep link from Settings; the
  `/start` payload captures `chat_id` and links it to their account. Alerts
  push as formatted messages linking back to the coin detail page.
- **Dashboard**: all alerts always land in the in-app Alerts feed regardless
  of Telegram linking status — the dashboard is never dependent on Telegram
  to be useful.

## Error Handling

- DexScreener request fails or is rate-limited mid-scan: skip that tick, log
  it, do not crash the cron route. Alerts are best-effort/eventually
  consistent, not a real-time guarantee.
- Partial/missing fields on a pair (e.g. a brand-new pair with no volume
  data yet): exclude from scoring until required fields are populated —
  never score against nulls.
- Telegram delivery failure (bot blocked, invalid `chat_id`): log it and mark
  that channel dead for the user; do not retry-loop. The dashboard feed still
  carries the alert regardless.

## Testing

- **Scoring function**: unit tests against fixed snapshot fixtures (known-good
  and known-bad token shapes), so factor weights are testable independent of
  live API calls.
- **Alert trigger logic**: unit tests per alert type using synthetic snapshot
  sequences (e.g. a fabricated liquidity-drop sequence asserts Liquidity
  Danger fires once and does not refire within its cooldown).
- **Pipeline integration**: the cron route tested against a mocked
  DexScreener response, asserting snapshots/scores/alerts land correctly in
  Postgres.

## Out of Scope for v1

- Wallet/holder tracking (Helius): holder growth, top-holder concentration,
  dev-wallet-selling detection, "top wallet selling" alert.
- Social signal scraping (X/Twitter/Telegram sentiment).
- SMS delivery.
- Wallet-linked automatic position detection (v1 uses manual entry only).
- Per-user configurable alert thresholds (v1 ships with fixed system
  defaults).
- A backtesting UI/feature (the backtest itself is a one-time pre-launch
  validation step, not a product feature).
