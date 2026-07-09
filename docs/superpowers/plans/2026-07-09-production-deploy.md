# Production Deployment (Code Changes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codebase actually deployable — fix the two real gaps that would break production (cron routes Vercel can't invoke, a signup flow that assumes email confirmation is off) — and add the Vercel cron configuration. This plan covers only what can be built and tested without any hosting credentials; the credential-dependent infrastructure provisioning (creating the Supabase Cloud project, linking Vercel, setting environment variables, the first real deploy) is a separate phase that happens once those credentials are available, not part of this plan.

**Architecture:** Three tasks: make both cron routes respond to Vercel's actual invocation method (`GET`, not just `POST`); make the signup route and page handle the case where Supabase doesn't establish a session immediately (email confirmation pending); add `vercel.json` with both cron schedules. No new dependencies, no new files beyond `vercel.json`.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Vitest. No new dependencies.

## Global Constraints

- Local dev keeps Supabase's email auto-confirm setting untouched — the new "confirmation pending" branch in the signup flow is exercised by tests via mocking, not by anything that changes local dev's actual behavior.
- `CRON_SECRET`-based authorization on both cron routes is unchanged in spirit — `GET` gets the exact same check `POST` already has, not a weaker one.
- `vercel.json`'s cron schedules are once-daily each (Hobby-plan compatible), offset from each other so they don't both fire at the same moment.
- Node 23.x, TypeScript strict mode, Next.js App Router only.

---

## File Structure

- `src/app/api/cron/scan/route.ts` — modified: export `GET` alongside `POST`
- `src/app/api/cron/scan/route.test.ts` — modified: add a `GET` coverage test
- `src/app/api/cron/positions/route.ts` — modified: export `GET` alongside `POST`
- `src/app/api/cron/positions/route.test.ts` — modified: add a `GET` coverage test
- `src/app/api/auth/signup/route.ts` — modified: return `sessionEstablished`
- `src/app/api/auth/signup/route.test.ts` — modified: update the existing success test's mock, add a confirmation-pending test
- `src/app/signup/page.tsx` — modified: show a "check your email" state when `sessionEstablished` is `false`
- `vercel.json` — new

---

### Task 1: Cron routes respond to Vercel's actual invocation method

**Files:**
- Modify: `src/app/api/cron/scan/route.ts`
- Modify: `src/app/api/cron/scan/route.test.ts`
- Modify: `src/app/api/cron/positions/route.ts`
- Modify: `src/app/api/cron/positions/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: both routes now export `GET` (identical behavior to the existing `POST`) in addition to `POST`.

- [ ] **Step 1: Add the failing test for the scan route**

In `src/app/api/cron/scan/route.test.ts`, change the import on line 5 from:

```typescript
import { POST } from './route';
```

to:

```typescript
import { GET, POST } from './route';
```

Then add this `describe` block anywhere after the existing `describe('POST /api/cron/scan', ...)` block:

```typescript
describe('GET /api/cron/scan', () => {
  it('rejects requests without the correct bearer token, same as POST', async () => {
    const response = await GET(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- api/cron/scan/route.test
```

Expected: FAIL — `GET` is not exported from `./route`.

- [ ] **Step 3: Export `GET` from the scan route**

At the end of `src/app/api/cron/scan/route.ts`, after the existing `export async function POST(...)` block, add:

```typescript
export { POST as GET };
```

Vercel Cron Jobs always invoke the configured path via `GET` with an `Authorization: Bearer $CRON_SECRET` header (automatically attached when `CRON_SECRET` is set as a Vercel environment variable) — the route's logic doesn't care which HTTP method was used, only the header, so aliasing is correct and requires no branching.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- api/cron/scan/route.test
```

Expected: PASS, all tests including the new one.

- [ ] **Step 5: Repeat for the positions route — add the failing test**

In `src/app/api/cron/positions/route.test.ts`, change the import on line 7 from:

```typescript
import { POST } from './route';
```

to:

```typescript
import { GET, POST } from './route';
```

Then add this `describe` block anywhere after the existing `describe('POST /api/cron/positions', ...)` block:

```typescript
describe('GET /api/cron/positions', () => {
  it('rejects requests without the correct bearer token, same as POST', async () => {
    const response = await GET(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
npm test -- api/cron/positions/route.test
```

Expected: FAIL — `GET` is not exported from `./route`.

- [ ] **Step 7: Export `GET` from the positions route**

At the end of `src/app/api/cron/positions/route.ts`, after the existing `export async function POST(...)` block, add:

```typescript
export { POST as GET };
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
npm test -- api/cron/positions/route.test
```

Expected: PASS, all tests including the new one.

- [ ] **Step 9: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/cron/scan/route.ts src/app/api/cron/scan/route.test.ts src/app/api/cron/positions/route.ts src/app/api/cron/positions/route.test.ts
git commit -m "feat: make cron routes respond to GET so Vercel Cron Jobs can invoke them"
```

---

### Task 2: Signup handles email-confirmation-pending accounts

**Files:**
- Modify: `src/app/api/auth/signup/route.ts`
- Modify: `src/app/api/auth/signup/route.test.ts`
- Modify: `src/app/signup/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/auth/signup`'s success response becomes `{ userId: string | null; sessionEstablished: boolean }` (was `{ userId: string | null }`).

- [ ] **Step 1: Update the existing success test's mock and add the new test**

In `src/app/api/auth/signup/route.test.ts`, replace the `'creates a user and returns 201 on success'` test with:

```typescript
  it('creates a user and returns 201 with sessionEstablished true when a session is issued immediately', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-123' }, session: { access_token: 'fake-token' } },
      error: null,
    });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ userId: 'user-123', sessionEstablished: true });
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter22' });
  });

  it('returns 201 with sessionEstablished false when email confirmation is pending', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-456' }, session: null },
      error: null,
    });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ userId: 'user-456', sessionEstablished: false });
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

```bash
npm test -- api/auth/signup/route.test
```

Expected: FAIL — the current route always returns `{ userId }` with no `sessionEstablished` field.

- [ ] **Step 3: Update the signup route**

In `src/app/api/auth/signup/route.ts`, replace the final line:

```typescript
  return NextResponse.json({ userId: data.user?.id ?? null }, { status: 201 });
```

with:

```typescript
  return NextResponse.json(
    { userId: data.user?.id ?? null, sessionEstablished: data.session !== null },
    { status: 201 }
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- api/auth/signup/route.test
```

Expected: PASS, all tests.

- [ ] **Step 5: Update the signup page**

In `src/app/signup/page.tsx`, add a new state variable and branch on `sessionEstablished`. Replace the imports and component body as follows.

Add to the existing `useState` declarations (after the `submitting` state):

```typescript
  const [confirmationPending, setConfirmationPending] = useState(false);
```

Replace the `handleSubmit` function's success path:

```typescript
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  }
```

with:

```typescript
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    const body: { sessionEstablished: boolean } = await response.json();
    if (!body.sessionEstablished) {
      setSubmitting(false);
      setConfirmationPending(true);
      return;
    }

    router.push("/");
    router.refresh();
  }
```

Then, immediately after the opening `return (` of the component's JSX (i.e., wrap the existing return in a conditional), change:

```typescript
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4">
```

to:

```typescript
  if (confirmationPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        <RadarSweep size={96} />
        <div className="w-full max-w-sm">
          <h1 className="mb-2 font-mono text-2xl tracking-wide text-amber">Check your email</h1>
          <p className="text-sm text-ink/70">
            We sent a confirmation link to your email address. Click it, then{" "}
            <Link href="/login" className="text-amber hover:underline">
              log in
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4">
```

The rest of the file (the form JSX) is unchanged.

- [ ] **Step 6: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/auth/signup/route.ts src/app/api/auth/signup/route.test.ts src/app/signup/page.tsx
git commit -m "feat: handle email-confirmation-pending accounts in the signup flow"
```

---

### Task 3: Vercel cron configuration and final verification

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: `/api/cron/scan`, `/api/cron/positions` (Task 1).

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "0 0 * * *" },
    { "path": "/api/cron/positions", "schedule": "0 6 * * *" }
  ]
}
```

Both schedules are once-daily (Hobby-plan compatible), offset six hours apart so they don't compete for the same moment.

- [ ] **Step 2: Verify the JSON is well-formed**

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json', 'utf8')); console.log('valid JSON')"
```

Expected: prints `valid JSON` with no error.

- [ ] **Step 3: Run the full test suite and build one more time**

```bash
npm test
npm run build
```

Expected: all tests pass; build succeeds with no errors (a static `vercel.json` at the repo root doesn't affect the Next.js build itself, but this confirms nothing else regressed across all three tasks together).

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel cron configuration for scan and position monitoring"
```

---

## Self-Review Notes

- **Spec coverage:** both real gaps identified in the design spec (cron routes not `GET`-invocable, signup assuming immediate session) are fixed with tests. `vercel.json` matches the spec's exact schedule. The credential-dependent infrastructure provisioning (Supabase Cloud project, Vercel project linking, environment variables, first deploy) is deliberately excluded from this plan's tasks, per the spec's explicit sequencing — it happens once those credentials are available, as a separate, non-code-plan phase.
- **Backward compatibility of the signup response shape:** `sessionEstablished` is an added field, not a renamed or removed one — `userId` stays exactly as it was, so nothing else that might read this response (nothing currently does, but flagging for completeness) breaks.
- **Local dev is unaffected by Task 2:** local Supabase's auto-confirm setting means `data.session` will always be non-null there, so `sessionEstablished` will always be `true` and the new "check your email" branch simply never triggers locally — this is confirmed by the plan's test mocking the confirmation-pending case explicitly rather than relying on any real local infrastructure to produce it.
- **Type consistency:** the signup page's new `body: { sessionEstablished: boolean }` type annotation matches exactly what Task 2's route now returns — no drift.
