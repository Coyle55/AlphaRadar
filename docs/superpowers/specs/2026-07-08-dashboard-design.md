# Auth UI & Discovery Feed — Plan 3c Design

## Summary

This is Plan 3c, following Plan 3a (auth backend, merged) and Plan 3b
(positions/position alerts, merged). It's the first slice of the original
"Plan 3c" dashboard scope: login/signup pages and the discovery feed as the
protected home screen. Coin detail, watchlist, alerts page, and settings are
explicitly deferred to follow-up plans — none of them are needed to make
this slice genuinely useful on its own.

Every prior plan built write-side infrastructure (ingestion, scoring,
alerts). Nothing yet exposes scored tokens for *reading*, and there's no UI
of any kind. This plan adds both.

## Goals

- A logged-out visitor can sign up or log in.
- A logged-in user sees a ranked, scannable feed of currently-live scored
  Solana tokens as their home screen — the first thing this product has ever
  shown a human being, not just an API response.
- The visual identity is deliberately not a generic dashboard: this is a
  trading terminal, and it should look and feel like one.

## Pages

- `/login`, `/signup` — forms (Client Components) posting to Plan 3a's
  existing `POST /api/auth/login` / `POST /api/auth/signup` — no backend
  changes needed for these, they already work. On success, redirect to `/`.
  Signup is expected to establish a session immediately (Supabase issues a
  session on signup when auto-confirm is on, which it is, per Plan 3a) — this
  gets verified live during implementation; if it turns out signup doesn't
  set a usable session, the fallback is redirecting to `/login` instead of
  `/` after signup.
- `/` — the discovery feed, protected. A Server Component that calls
  `getCurrentUser()` (Plan 3a) directly and redirects to `/login` via
  `next/navigation`'s `redirect()` if not authenticated — no client-side
  auth-check flash on load.
- A shared layout for the protected area: app name/wordmark, the logged-in
  user's email, a logout button (`POST /api/auth/logout`, redirect to
  `/login`).

## Discovery Feed Data

New server-side data function (not a separate API route — the page calls it
directly as a Server Component; nothing else consumes this data yet, so a
same-origin API round-trip would be pure overhead). Query behavior:

- Each token's **most recent** score only — `token_scores` has one row per
  scan tick, so this needs "latest score per token," not full history.
- Filtered to tokens scored within the **last 2 hours** — otherwise the feed
  accumulates tokens that fell out of DexScreener's trending list and
  stopped being rescanned, showing stale data indefinitely.
- Ordered by score descending, capped at **top 50**.
- Filtering by score/alert type (mentioned in the original product spec) is
  explicitly deferred — v1 ships the plain ranked list.

The full "thesis" block (entry zone / stop level / take-profit levels / red
flags) does not exist anywhere in the backend yet — it's new logic that
belongs on the future Coin Detail page, not this list view. This page shows
metrics per token (score, price, market cap, liquidity, volume), not
generated thesis text.

## Visual Design

Grounded in the actual subject: this is a trading terminal, not a
marketing site or generic dashboard. The reference point is Bloomberg
terminal's historical dark/amber-phosphor lineage, reinterpreted for Solana
meme coins — a real, specific anchor for this domain rather than "dark mode
because crypto." The product name and its actual mechanism (periodic
scanning) become the signature: a slow radar-sweep motif, used as an
ambient moment on the login/signup screens (where there's little else to
show) and reused in miniature as a functional "last scanned" freshness
indicator in the dashboard header — encoding real information (data
recency), not decoration.

**Color:**
- `--bg: #0B0D0E` — near-black terminal background
- `--bg-panel: #14171A` — panel/row background
- `--amber: #FFB000` — primary accent: the radar sweep, score signal fill,
  primary actions
- `--signal-green: #3DDC84` — price up (follows trading convention — this
  is a hard convention in the domain, not a place to deviate for novelty)
- `--signal-red: #FF4D4D` — price down / danger
- `--text-primary: #EDEDE8` — warm off-white (ties to the amber warmth,
  not pure white)

**Type:** IBM Plex Mono for headlines *and* all numeric data (price, score,
volume, liquidity, market cap) — monospace-for-data is a real terminal
convention (tabular alignment), not just an aesthetic choice. IBM Plex Sans
for body copy and UI labels/buttons. Same type family, designed to pair.

**Layout:** the discovery feed is a dense table/list (rank, symbol/name, a
signal-strength bar for the score — amber fill proportional to score value,
not just a numeral, since the product's whole job is compressing noisy data
into one signal — price, 1h volume, liquidity, market cap, and a small
colored tag for any currently-active discovery alert on that token, color
matched to the alert's severity). Not a card grid — a trader scanning a
watchlist wants density and scannability, not whitespace.

Login/signup pages are minimal, centered forms on the same dark background,
with the radar-sweep as the one animated/ambient moment — this is the one
place in the product with room for a "hero" beat before the user reaches
the dense data view.

## Error Handling

- Login/signup form errors (validation, wrong credentials, duplicate email)
  surface inline in the form using the existing API routes' error response
  bodies (Plan 3a's routes already return clear, correctly-scoped error
  messages — login's generic "invalid email or password," signup's specific
  validation errors).
- An empty discovery feed (nothing scored in the last 2 hours — plausible
  early on, or if the cron scan hasn't run recently) shows a clear, honest
  state explaining why, not a blank page or a spinner that never resolves.

## Testing

- The discovery feed's data function is tested against real local Postgres,
  same pattern as every other DB-touching function in this project (insert
  fixture tokens/scores at varying recency and score values, assert the
  query returns the right ones in the right order).
- Login/signup/logout forms and the protected-route redirect are verified
  live in a real browser against the real dev server and real local
  Supabase Auth — this is genuinely UI/interaction behavior (form
  submission, cookie-based redirect, rendered layout), which automated
  component tests would only partially cover and which this project has no
  existing browser-automation tooling for. Per the project's established
  practice for frontend work: start the dev server, exercise the actual
  flows in a browser, don't just claim success from passing unit tests.

## Out of Scope for Plan 3c

- Coin detail page (score breakdown, thesis generation, price chart) — a
  future plan; thesis generation in particular is new backend logic that
  doesn't exist yet.
- Watchlist / "I bought this" UI (Plan 3b's `POST /api/positions` exists as
  an API but has no UI in front of it yet) — future plan.
- Alerts page (chronological feed of fired alerts) — future plan.
- Settings (Telegram linking, subscription/billing) — future plan; neither
  per-user Telegram linking nor billing exist in the backend yet.
- Filtering the discovery feed by score/alert type — deferred per the
  scope decision above.
- Any client-side auto-refresh/polling of the discovery feed — v1 is a
  server-rendered snapshot on page load; manual reload is the v1 workflow.
