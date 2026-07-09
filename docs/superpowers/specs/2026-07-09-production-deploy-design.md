# Production Deployment — Design

## Summary

All four dashboard pages are done, but the product has only ever run
against a local dev Supabase/Postgres stack — nothing is deployed, and
the scan pipeline has no real scheduled trigger anywhere. This plan gets
AlphaRadar live: hosted on Vercel, backed by a Supabase Cloud project,
with both cron jobs running automatically once daily each, alerting to
the existing Telegram bot/chat, on the default `*.vercel.app` domain,
with real email confirmation required for signup.

## Goals

- The app is reachable at a public `*.vercel.app` URL.
- `/api/cron/scan` and `/api/cron/positions` run automatically once a
  day each via Vercel Cron Jobs, on the free Hobby plan.
- Production data lives in a hosted Supabase Cloud project (Postgres +
  Auth), not the local Docker stack.
- New signups require email confirmation before they can log in.
- Telegram alerts continue going to the same bot/chat used throughout
  local development.

## Real gaps found grounding this in the actual code

Two things in the current codebase would silently break in production —
these are real deliverables in this plan, not just infrastructure
config:

1. **Both cron routes only export a `POST` handler**
   (`src/app/api/cron/scan/route.ts`, `src/app/api/cron/positions/route.ts`).
   Vercel Cron Jobs always invoke the configured path via `GET`, with an
   `Authorization: Bearer $CRON_SECRET` header automatically attached
   when `CRON_SECRET` is set as a Vercel environment variable. As
   written, Vercel's scheduler cannot trigger either endpoint — there is
   no `GET` handler to receive the call.

   Fix: add a `GET` export to each route that does exactly what the
   existing `POST` handler does (same `CRON_SECRET` bearer check, same
   pipeline call). `POST` stays, since every prior plan's live
   verification has curled these routes with `POST` and that convention
   is worth preserving for manual testing.

2. **The signup flow assumes `POST /api/auth/signup` always yields an
   immediate session.** Today, with Supabase's email auto-confirm
   enabled (the local dev setting), that assumption holds — `signUp()`
   returns both a user and a session, so redirecting straight to `/`
   after a 201 works. Once the hosted Supabase project has "Confirm
   email" turned on, `signUp()` returns a user but `session: null` until
   the email link is clicked. The current frontend would still redirect
   to `/`, get silently bounced back to `/login` by the auth gate (no
   session cookie was ever set), and look like signup failed with no
   explanation.

   Fix: `POST /api/auth/signup` returns whether Supabase actually
   established a session (`{ userId, sessionEstablished: boolean }`,
   derived from whether `data.session` is non-null in the Supabase
   response). The signup page checks this: if `sessionEstablished` is
   `false`, it shows a "Check your email to confirm your account, then
   log in" message instead of redirecting to `/`. This is the one place
   the local dev experience and the deployed experience genuinely
   diverge — local dev's auto-confirm setting is untouched, so
   `sessionEstablished` will always be `true` there and this new branch
   simply won't trigger locally.

## Infrastructure provisioning

Split between steps that need your accounts/billing and steps I can
drive from the terminal once you provide the resulting credentials.

**You provide (when you're back):**
- A new Supabase Cloud project — project ref, the project's Postgres
  connection string, and its `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` values (from Project Settings → API).
- Confirmation that "Confirm email" is turned on in that project's Auth
  settings (Authentication → Providers → Email → "Confirm email").
- A Vercel account/project linked to `Coyle55/AlphaRadar` (the `vercel`
  CLI is already installed locally — I can run `vercel link` and
  `vercel --prod` once you've authenticated the CLI once with
  `vercel login`).

**I do (once the above is provided):**
- Apply the existing migrations (`supabase/migrations/0001` through
  `0008`) to the new hosted Postgres via the Supabase CLI.
- Set the production environment variables in Vercel (`DATABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
  new project; `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  reused from the real values already used throughout local dev).
- Trigger and verify the first production deploy, including confirming
  the cron jobs actually fire (Vercel's dashboard shows cron execution
  history) and the full auth/discovery/positions/alerts flow works
  against the real hosted stack.

**Sequencing:** the code changes (both fixes above) and `vercel.json`
don't need any of the above and can be built, tested, and reviewed
entirely against local dev first — the credential-dependent
provisioning is a separate final phase.

## `vercel.json`

```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "0 0 * * *" },
    { "path": "/api/cron/positions", "schedule": "0 6 * * *" }
  ]
}
```

Both run once daily (Hobby-plan compatible — the free tier allows daily
cron at minimum). Offset by six hours from each other rather than both
firing at midnight, so a slow scan run and a slow position-check run
don't compete for the same moment — arbitrary but reasonable; can be
adjusted later with a dashboard-only change, no code involved.

## Testing

- The cron routes' new `GET` handlers get unit tests confirming
  identical behavior to the existing `POST` tests (same auth check, same
  result) — extending the existing test files, not new ones.
- The signup route's `sessionEstablished` field gets tested for both
  cases: a normal auto-confirm signup (session present) and a
  confirmation-required signup (session absent) — the latter mocked via
  Supabase's `signUp` response shape, not a real hosted project (local
  dev's Supabase instance has auto-confirm on, so this branch can't be
  exercised against real local infrastructure).
- The signup page's new "check your email" state gets verified live via
  curl the same way every prior plan's UI work has been — checking the
  response body's structural content for both branches (a normal
  `sessionEstablished: true` signup vs. a `sessionEstablished: false`
  one), not a real email-confirmation click-through, which is out of
  reach for curl-based verification.
- The actual production deploy — real hosted Supabase, real Vercel cron
  firing, a real signup requiring a real email click-through — is
  verified live against the deployed environment once credentials are
  provided, not something a local test suite can prove.

## Out of Scope

- Custom domain (default `*.vercel.app` for now).
- Per-user Telegram linking, billing/subscription.
- A staging/preview environment strategy beyond Vercel's default
  per-PR previews.
- Uptime monitoring, error tracking (e.g. Sentry), or other
  observability tooling beyond what Vercel's dashboard provides by
  default.
