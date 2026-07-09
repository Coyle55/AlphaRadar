# Coin Detail Page — Design

## Summary

Plan 3c shipped a ranked discovery feed but no way to see *why* a token
scored the way it did. This plan adds a Coin Detail page: click a row in
the feed, land on a page that shows the full score breakdown, a
mechanical entry/stop/take-profit framework (risk-framed, explicitly not
a buy signal), and a price-history chart built from our own scan data.
Read-only — no position-logging UI here, that belongs to the separate
Watchlist plan.

## Goals

- A logged-in user can click any discovery-feed row and see that token's
  full story: current stats, why it scored what it scored, a mechanical
  risk framework, and its price trajectory since we started tracking it.
- The score breakdown makes the previously-opaque total legible — each of
  the 7 scoring factors shown individually, signed and labeled.
- The thesis is explicit about what it is: a fixed-percentage risk
  framework, not a prediction or advice to buy. This matches the
  product's original stance (score/alert, never "buy this").

## Pages

- `/token/[mintAddress]` — protected the same way as `/`: a Server
  Component that calls `getCurrentUser()` and `redirect()`s to `/login`
  if unauthenticated.
- Each row in the discovery feed (`src/app/(app)/page.tsx`, Plan 3c)
  becomes a link to `/token/{mintAddress}`. `DiscoveryFeedItem` (Plan 3c)
  does not currently expose `mintAddress` — it needs to be added to that
  type and its query so the feed can link to detail pages. This is a
  small, backward-compatible addition to an existing function, not a new
  one.
- If the mint address in the URL doesn't correspond to any token we've
  ever scanned, the page calls Next.js's `notFound()` — a real 404, not a
  blank page or a redirect.

## Data

New function `getTokenDetail(mintAddress: string)` in
`src/lib/db/tokenDetail.ts`:

- Looks up the token by `mint_address`. Returns `null` if no such token
  exists (the page turns `null` into `notFound()`).
- Fetches the latest snapshot + score for that token (same "latest row"
  pattern as Plan 3c's discovery feed — `DISTINCT ON`/`ORDER BY ...
  captured_at DESC`), giving current price, liquidity, volume, market
  cap, and the full `ScoreFactors` breakdown (all 7 factors already
  exist in `token_scores.factors` per Plan 1 — no new scoring logic
  needed for the breakdown).
- Fetches the **full snapshot history** for that token — every
  `token_snapshots` row for `token_id`, just `price_usd` and
  `captured_at`, ordered chronologically ascending — to drive the price
  chart. No time-window filter here (unlike the discovery feed's 2-hour
  window): a token's whole tracked history is exactly what a detail page
  should show, however long or short that turns out to be.
- No new database tables or columns. Everything needed already exists in
  `tokens`, `token_snapshots`, `token_scores`.

### Thesis calculation (new logic — the one genuinely new piece of business logic in this plan)

A pure function, `computeThesis(currentPrice: number): Thesis`, in
`src/lib/scoring/thesis.ts`:

- `entry = currentPrice` (the reference point — "if you're evaluating
  this token right now, here's today's price," not a suggested entry
  different from spot).
- `stop = currentPrice * 0.85` (-15%).
- `takeProfit1 = currentPrice * 1.5` (+50%).
- `takeProfit2 = currentPrice * 2.0` (+100%).

These are fixed percentage bands, not derived from the score or any
per-token signal — deliberately simple and mechanical for v1, easy to
explain, easy to recalibrate later once there's real outcome data to
tune against. The page renders this next to an explicit eyebrow label
("MECHANICAL FRAMEWORK — NOT A PREDICTION") and one line of disclaimer
copy making clear this is a risk-management scaffold, not a signal.

## Visual Design

Reuses Plan 3c's design system entirely — same color tokens, same
IBM Plex Mono/Sans pairing, same dark terminal background. No new colors,
no new fonts, no new signature element (the radar-sweep stays reserved
for auth pages and the feed's freshness indicator — this page's own
"structure is information" device is the score-breakdown bars and the
price chart, both driven by real data, not decoration).

Three zones, top to bottom:

**1. Masthead**
- Symbol + name (`font-mono`, large).
- Current price, large, `font-mono`.
- 24h price change, color-coded: `text-signal-green` if positive,
  `text-signal-red` if negative (reuses the existing signal-color
  convention — these tokens are reserved for price-direction semantics,
  and this is exactly that).
- The score: both the existing amber signal-bar treatment (as in the
  feed) *and*, unlike the feed, the actual numeric total — the feed
  hides the number for scanability across many rows; a single detail
  page has room for precision.
- A stat strip: liquidity, 24h volume, market cap — same `formatUsd`
  helper from the discovery feed page, reused not reimplemented.

**2. Price history chart**
- A plain inline SVG polyline built directly from `getTokenDetail`'s
  snapshot-history array — no charting library dependency. Flat amber
  stroke (`--color-amber`), 2px, no fill, on the panel background.
  Min/max price labels at the top/bottom of the chart's vertical range,
  a "tracked since {formatted timestamp of the first snapshot}" label.
- If the token has fewer than 2 snapshots, render an honest "Not enough
  price history yet — check back after a few more scans" message in
  place of the chart. A single point can't be a line; don't fake one.

**3. Two-column zone**
- **Score Breakdown** (left) — all 7 `ScoreFactors` as horizontal bars,
  in the scoring code's natural order (volume momentum, liquidity
  growth, price strength, buy/sell ratio, market cap band, liquidity
  level, wick rejection — the order they're computed in
  `src/lib/scoring/score.ts`). Each bar's fill color is
  `text-signal-green`/`bg-signal-green` tinted when the factor is
  positive (adds to the score) and `text-signal-red`/`bg-signal-red`
  tinted when negative, with the factor's point value shown as a
  number. Bar length is proportional to `Math.abs(value)` against each
  factor's own fixed max-possible-magnitude, taken directly from
  `score.ts`: 20 for volume momentum, 15 for liquidity growth, 15 for
  price strength, 15 for buy/sell ratio, 10 for market cap band, 20 for
  liquidity level (its range is +15/0/-20 — the -20 downside case sets
  the scale, not the +15 upside), 15 for wick rejection. This is fixed
  per factor, not relative to the other factors in the same render, so a
  bar's length is comparable across different tokens' detail pages.
- **Thesis** (right) — entry/stop/take-profit-1/take-profit-2 from
  `computeThesis`, each row showing the label, the percentage, and the
  computed dollar price. The eyebrow label and disclaimer described
  above sit at the top of this panel.

Human-readable labels for the 7 factors (used in the Score Breakdown —
these are new UI-layer copy, the underlying `ScoreFactors` keys stay
unchanged):

| Factor key | Label |
|---|---|
| `volumeMomentum` | Volume Momentum |
| `liquidityGrowth` | Liquidity Growth |
| `priceStrength` | Price Strength |
| `buySellRatio` | Buy/Sell Ratio |
| `marketCapBand` | Market Cap Band |
| `liquidityLevel` | Liquidity Level |
| `wickRejection` | Wick Rejection |

## Error Handling

- Mint address with no matching token → `notFound()` (real Next.js 404).
- Token exists but has fewer than 2 snapshots → chart zone shows the
  "not enough history yet" message; masthead, score breakdown, and
  thesis all still render normally (a token can't have a score without
  at least one snapshot, so these are never blocked by sparse history).
- No other error states are new here — auth failure behaves exactly as
  it does on `/` (redirect to `/login`).

## Testing

- `getTokenDetail()` tested against real local Postgres, same pattern as
  every DB-touching function in this project: token not found, token
  with one snapshot (sparse-history case), token with multiple
  snapshots (ordering + latest-score correctness).
- `computeThesis()` is a pure function — tested with plain Vitest unit
  tests (no DB), given fixed inputs and asserting exact outputs.
- The page itself (layout, chart rendering, breakdown bars, thesis
  panel) is verified live against the real dev server. This project has
  no browser-automation tooling, so — consistent with Plan 3c — this
  means curl-based structural verification (correct markup, correct
  values in the rendered HTML) rather than literal visual browser
  checks; genuine visual/aesthetic confirmation happens separately when
  a human opens the dev server in a real browser.

## Out of Scope

- Position-logging CTA on this page (the Watchlist plan, next up per
  priority, is where "log a position" UI belongs).
- Any per-token alert history (the future Alerts page).
- Any external chart data source (DexScreener embed or similar) — this
  plan uses only our own snapshot history.
- Editing or annotating the thesis, or any per-token override of the
  fixed percentage bands.
- Backfilling snapshot history for tokens scanned before this plan
  shipped — there is none to backfill; history simply starts
  accumulating from whenever a token was first scanned, same as today.
