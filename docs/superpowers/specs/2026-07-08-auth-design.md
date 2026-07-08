# Auth — Plan 3a Design

## Summary

This is Plan 3a of the v1 build (see `2026-07-08-meme-coin-radar-v1-design.md` for
full product context). The original "Plan 3" — auth, positions, position
alerts, per-user Telegram linking, and the full dashboard UI — is itself
multiple independent subsystems, so it's being split further:

- **Plan 3a (this plan)**: user accounts. Foundational; everything else needs it.
- **Plan 3b**: positions, position alerts (Take Profit, Exit Warning), and
  per-user Telegram linking — extends Plan 2's alert pipeline with account-scoped
  data.
- **Plan 3c**: the dashboard UI (discovery feed, coin detail, watchlist, alerts
  page, settings) — pure presentation over data that already exists by 3a/3b.

Plan 3a delivers signup/login/logout as an API surface only — no web UI. The
login/signup forms themselves are Plan 3c's job; this plan makes the backend
they'll call.

## Goals

- Users can create an account and log in/out, with sessions handled correctly
  in Next.js's App Router.
- Every user gets an app-specific `profiles` row automatically, with room for
  Plan 3b (Telegram chat_id) and future billing (subscription_tier) without a
  later migration.
- No new auth infrastructure — reuse the Supabase Auth service already running
  in the local Docker stack since Plan 1.

## Architecture

Supabase Auth owns credential storage and verification in its own managed
`auth.users` table — this project never touches password hashing directly.
Next.js integrates via `@supabase/ssr`, the current standard package for
Supabase + Next.js App Router, which manages the session as an httpOnly
cookie set/read through Next.js's request/response objects.

Signups are auto-confirmed (no email verification step) — deferred until a
real email provider is configured for production. Locally and in this plan,
`supabase/config.toml`'s auth email-confirmation setting is turned off.

## Data Model

`public.profiles` — one row per user, linked 1:1 to `auth.users`:

- `id` (uuid, primary key, references `auth.users(id)` on delete cascade)
- `telegram_chat_id` (text, nullable) — populated by Plan 3b's Telegram
  linking flow; `null` until a user links their Telegram account.
- `subscription_tier` (text, not null, default `'free'`) — inert for now, no
  billing logic attached. Included now so Plan 3b/3c don't need a schema
  migration later to add it.
- `created_at` (timestamptz, default now())

A Postgres trigger on `auth.users` (`after insert`) auto-creates the matching
`profiles` row, so the two tables can never drift out of sync — there's no
code path where a user exists without a profile.

## API Surface

No web UI in this plan — these are the routes Plan 3c's forms will call:

- `POST /api/auth/signup` — email + password. Creates the `auth.users` row
  (auto-confirmed) and, via the trigger, the `profiles` row.
- `POST /api/auth/login` — email + password. Sets the session cookie.
- `POST /api/auth/logout` — clears the session cookie.
- `getCurrentUser(request)` — a server-side helper (not a route) that reads
  the session cookie and returns the current user or `null`. This is what
  Plan 3b's position-related routes will use to identify who's calling —
  it's the seam between this plan and the next.

## Error Handling

- Signup with an already-registered email: Supabase Auth returns an error;
  the route surfaces it as a 4xx with a clear message, not a generic 500.
- Login with wrong credentials: 401, no distinction in the error message
  between "no such user" and "wrong password" (standard practice — don't leak
  which one it was).
- `getCurrentUser` returns `null` for a missing/invalid/expired session
  rather than throwing — callers decide what to do (e.g. return 401).

## Testing

Same pattern established since Plan 1: real local services, no mocking of
our own infrastructure. Tests call the actual local Supabase Auth instance
(already running in the Docker stack) directly — signup/login/logout are
verified against the real thing, not a stub, the same way Plan 1/2's DB
tests hit real local Postgres rather than mocking `pg`.

## Out of Scope for Plan 3a

- Any login/signup UI — Plan 3c.
- Positions, position alerts, per-user Telegram linking — Plan 3b.
- Password reset / forgot-password flow — not blocking for v1, can follow
  once there are real users who need it.
- Billing/subscription enforcement — `subscription_tier` exists as a column
  only; no plan limits or payment processing in this plan.
- OAuth / social login — email+password only for v1, per the confirmed
  decision.
