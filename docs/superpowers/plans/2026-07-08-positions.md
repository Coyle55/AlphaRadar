# Positions & Position Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user record a position ("I bought this") against any Solana token, and have Take Profit / Exit Warning alerts fire against held positions on their own monitoring schedule — independent of whether the underlying token is still trending in the discovery scan. No UI (Plan 3c); delivery reuses Plan 2's shared Telegram chat rather than building per-user linking now (see the design spec's Scope Note for why).

**Architecture:** A new `positions` table and two new nullable columns on Plan 2's `alerts` table (`user_id`, `position_id`). A new, separate cron route (`POST /api/cron/positions`) walks open positions and reuses Plan 1/2's existing snapshot/scoring/history functions as-is — this plan adds no parallel scoring logic, only a second set of alert rules and a second alert-delivery loop shaped like Plan 2's, but iterating positions instead of scan candidates. Two small write-only routes (`POST /api/positions`, `DELETE /api/positions/:id`) sit in front of it, gated by Plan 3a's `getCurrentUser`.

**Tech Stack:** Same as Plans 1-3a — Next.js 16 (App Router) + TypeScript, local Supabase (Postgres + Auth), Vitest, `@supabase/supabase-js` (already installed, used here only for a test-fixture helper, not app code).

## Global Constraints

- Position monitoring never applies `passesHardFilter` — a held position must keep being checked even if it would no longer pass the discovery scan's liquidity/volume thresholds; falling below those thresholds is exactly the kind of thing Exit Warning exists to catch.
- Cooldown for position alerts is scoped by `(position_id, alert_type)`, not `(token_id, alert_type)` — two different positions on the same token (different entry prices) can have genuinely different trigger points.
- One position's processing failure (bad mint address, DexScreener error, a scoring guard throwing) is caught, logged, and does not fail the whole `/api/cron/positions` tick — same per-item isolation as Plan 1/2's per-candidate loop.
- `positions.entry_market_cap` is captured once, from the live DexScreener lookup at creation time — never re-derived later.
- Closing a position sets `closed_at`; it is never hard-deleted, preserving history.
- Every DB-touching function takes/returns plain TypeScript objects (no ORM), matching the established pattern.
- TypeScript strict mode on; Next.js App Router only.

---

## File Structure

- `supabase/migrations/0005_positions_table.sql` — new `positions` table
- `supabase/migrations/0006_alerts_user_position_columns.sql` — `alerts.user_id`, `alerts.position_id`, supporting index
- `src/lib/testing/testUser.ts` — test-only helper that creates a real Supabase Auth user (via `@supabase/supabase-js`, not the SSR/cookie client) so DB tests have a valid `auth.users.id` to satisfy the `positions.user_id` foreign key
- `src/lib/db/positions.ts` — `insertPosition`, `getPositionById`, `closePosition`, `getOpenPositions`
- `src/lib/db/alerts.ts` — **modified**: `AlertType` gains `'take_profit' | 'exit_warning'`; `NewAlertInput`/`AlertRecord` gain optional `userId`/`positionId`; new `wasPositionRecentlyAlerted`
- `src/lib/alerts/format.ts` — **modified**: export `ALERT_LABELS` and `escapeMarkdown` (currently module-private) so `src/lib/positions/format.ts` can reuse them; add the two new labels
- `src/lib/scan/filter.ts` — **modified**: gains `selectPair`, moved here from being a private function inside the cron scan route, since `POST /api/positions` needs the same highest-liquidity-matching-pair selection logic Plan 1 already built
- `src/app/api/cron/scan/route.ts` — **modified**: imports `selectPair` from `@/lib/scan/filter` instead of defining it locally (no behavior change)
- `src/lib/positions/rules.ts` — `evaluatePositionAlerts` (Take Profit, Exit Warning)
- `src/lib/positions/format.ts` — `formatPositionAlertMessage`
- `src/app/api/positions/route.ts` — `POST /api/positions`
- `src/app/api/positions/[id]/route.ts` — `DELETE /api/positions/:id`
- `src/app/api/cron/positions/route.ts` — `POST /api/cron/positions`
- Each new file has a co-located `*.test.ts`; modified files' existing tests are extended where needed

---

### Task 1: Migrations — `positions` table and `alerts` extension

**Files:**
- Create: `supabase/migrations/0005_positions_table.sql`
- Create: `supabase/migrations/0006_alerts_user_position_columns.sql`

**Interfaces:**
- Produces: a `positions` table and two new nullable columns on `alerts`, matching the types Task 2 (`src/lib/db/positions.ts`) and Task 3 (`src/lib/db/alerts.ts`) read/write.

- [ ] **Step 1: Write the positions migration**

```sql
-- supabase/migrations/0005_positions_table.sql
create table positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid not null references tokens(id) on delete cascade,
  entry_price numeric not null,
  entry_market_cap numeric not null,
  amount numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index positions_open_idx on positions(closed_at) where closed_at is null;
create index positions_user_id_idx on positions(user_id);
```

- [ ] **Step 2: Write the alerts-extension migration**

```sql
-- supabase/migrations/0006_alerts_user_position_columns.sql
alter table alerts add column user_id uuid references auth.users(id) on delete cascade;
alter table alerts add column position_id uuid references positions(id) on delete cascade;

create index alerts_position_type_triggered_idx on alerts(position_id, alert_type, triggered_at desc);
```

- [ ] **Step 3: Apply the migrations**

```bash
npx supabase db reset
```

Expected: re-applies all six migrations (0001-0006) with no errors.

- [ ] **Step 4: Verify the schema**

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "\d positions"
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "\d alerts"
```

Expected: `positions` lists all 8 columns plus both indexes and the two foreign keys; `alerts` now shows `user_id` and `position_id` in addition to its original columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_positions_table.sql supabase/migrations/0006_alerts_user_position_columns.sql
git commit -m "feat: add positions table and alerts user/position columns"
```

---

### Task 2: Positions DB access layer and test-user helper

**Files:**
- Create: `src/lib/testing/testUser.ts`
- Create: `src/lib/db/positions.ts`
- Test: `src/lib/db/positions.test.ts`

**Interfaces:**
- Consumes: `getPool`/`closePool` (`src/lib/db/pool.ts`), `upsertToken` (`src/lib/db/tokens.ts`) — both Plan 1, used in tests.
- Produces:
  - `createTestUser(): Promise<{ id: string; email: string }>` — creates a real Supabase Auth user (via `@supabase/supabase-js`'s plain client with a fresh random email each call, password satisfying the local minimum length) so tests have a valid `auth.users.id`. This deliberately does NOT go through Plan 3a's cookie-aware `@/lib/supabase/server` — there's no HTTP request/cookie context in a plain Vitest test, and this helper doesn't need one; it just needs a real row in `auth.users` to satisfy `positions.user_id`'s foreign key. Test rows accumulate in the local dev `auth.users` table over time — harmless in a local-only Postgres instance, same tradeoff already implicitly accepted for other test fixtures in this project.
  - `NewPositionInput { userId: string; tokenId: string; entryPrice: number; entryMarketCap: number; amount?: number }`
  - `PositionRecord { id: string; userId: string; tokenId: string; entryPrice: number; entryMarketCap: number; amount: number | null; openedAt: string; closedAt: string | null }`
  - `OpenPosition { id: string; userId: string; tokenId: string; mintAddress: string; pairAddress: string; entryPrice: number; entryMarketCap: number; initialLiquidityUsd: number }` — the `initialLiquidityUsd` field is `tokens.initial_liquidity_usd` (Plan 1), joined in so Task 6's cron route can call `scoreToken` with the correct baseline without a second query.
  - `insertPosition(input: NewPositionInput): Promise<PositionRecord>`
  - `getPositionById(id: string): Promise<PositionRecord | null>`
  - `closePosition(id: string): Promise<void>` — sets `closed_at = now()`
  - `getOpenPositions(): Promise<OpenPosition[]>` — all positions where `closed_at is null`, joined with their token's mint/pair address and initial liquidity

- [ ] **Step 1: Write the test-user helper**

```typescript
// src/lib/testing/testUser.ts
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export interface TestUser {
  id: string;
  email: string;
}

export async function createTestUser(): Promise<TestUser> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const email = `test-${randomUUID()}@example.com`;
  const password = 'test-password-123';
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? 'no user returned'}`);
  }
  return { id: data.user.id, email };
}
```

This has no test of its own — it's a test-only fixture helper, exercised indirectly by every test in this task (and later tasks) that calls it. If it's broken, every test that uses it fails loudly.

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/db/positions.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken } from './tokens';
import { createTestUser } from '../testing/testUser';
import { closePosition, getOpenPositions, getPositionById, insertPosition } from './positions';

beforeEach(async () => {
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('insertPosition and getPositionById', () => {
  it('creates a position and reads it back', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-1',
      pairAddress: 'pair-pos-1',
      symbol: 'POS1',
      name: 'Position Coin 1',
      initialLiquidityUsd: 50000,
    });

    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
      amount: 500,
    });

    expect(position.userId).toBe(user.id);
    expect(position.tokenId).toBe(token.id);
    expect(position.entryPrice).toBe(0.001);
    expect(position.entryMarketCap).toBe(1_000_000);
    expect(position.amount).toBe(500);
    expect(position.closedAt).toBeNull();

    const fetched = await getPositionById(position.id);
    expect(fetched).toEqual(position);
  });

  it('allows amount to be omitted', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-2',
      pairAddress: 'pair-pos-2',
      symbol: 'POS2',
      name: 'Position Coin 2',
      initialLiquidityUsd: 50000,
    });

    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });

    expect(position.amount).toBeNull();
  });

  it('returns null for a position that does not exist', async () => {
    const fetched = await getPositionById('00000000-0000-0000-0000-000000000000');
    expect(fetched).toBeNull();
  });
});

describe('closePosition', () => {
  it('sets closedAt', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-3',
      pairAddress: 'pair-pos-3',
      symbol: 'POS3',
      name: 'Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });

    await closePosition(position.id);

    const fetched = await getPositionById(position.id);
    expect(fetched?.closedAt).not.toBeNull();
  });
});

describe('getOpenPositions', () => {
  it('returns only open positions, joined with token mint/pair address and initial liquidity', async () => {
    const user = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-pos-4',
      pairAddress: 'pair-pos-4',
      symbol: 'POS4',
      name: 'Position Coin 4',
      initialLiquidityUsd: 42000,
    });
    const closedToken = await upsertToken({
      mintAddress: 'mint-pos-5',
      pairAddress: 'pair-pos-5',
      symbol: 'POS5',
      name: 'Position Coin 5',
      initialLiquidityUsd: 50000,
    });

    const openPosition = await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const closedPositionRecord = await insertPosition({
      userId: user.id,
      tokenId: closedToken.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });
    await closePosition(closedPositionRecord.id);

    const open = await getOpenPositions();

    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(openPosition.id);
    expect(open[0].mintAddress).toBe('mint-pos-4');
    expect(open[0].pairAddress).toBe('pair-pos-4');
    expect(open[0].initialLiquidityUsd).toBe(42000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- db/positions.test
```

Expected: FAIL — `./positions` module doesn't exist.

- [ ] **Step 4: Implement the positions DB access layer**

```typescript
// src/lib/db/positions.ts
import { getPool } from './pool';

export interface NewPositionInput {
  userId: string;
  tokenId: string;
  entryPrice: number;
  entryMarketCap: number;
  amount?: number;
}

export interface PositionRecord {
  id: string;
  userId: string;
  tokenId: string;
  entryPrice: number;
  entryMarketCap: number;
  amount: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface OpenPosition {
  id: string;
  userId: string;
  tokenId: string;
  mintAddress: string;
  pairAddress: string;
  entryPrice: number;
  entryMarketCap: number;
  initialLiquidityUsd: number;
}

function mapPositionRow(row: any): PositionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenId: row.token_id,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    amount: row.amount === null ? null : Number(row.amount),
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
  };
}

export async function insertPosition(input: NewPositionInput): Promise<PositionRecord> {
  const result = await getPool().query(
    `insert into positions (user_id, token_id, entry_price, entry_market_cap, amount)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at`,
    [input.userId, input.tokenId, input.entryPrice, input.entryMarketCap, input.amount ?? null]
  );
  return mapPositionRow(result.rows[0]);
}

export async function getPositionById(id: string): Promise<PositionRecord | null> {
  const result = await getPool().query(
    `select id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at
     from positions where id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return mapPositionRow(result.rows[0]);
}

export async function closePosition(id: string): Promise<void> {
  await getPool().query(`update positions set closed_at = now() where id = $1`, [id]);
}

export async function getOpenPositions(): Promise<OpenPosition[]> {
  const result = await getPool().query(
    `select p.id, p.user_id, p.token_id, p.entry_price, p.entry_market_cap,
            t.mint_address, t.pair_address, t.initial_liquidity_usd
     from positions p
     join tokens t on t.id = p.token_id
     where p.closed_at is null`
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    pairAddress: row.pair_address,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    initialLiquidityUsd: Number(row.initial_liquidity_usd),
  }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- db/positions.test
```

Expected: PASS, all 6 tests. (Each test that calls `createTestUser()` makes a real network call to local Supabase Auth — expect this file to run a bit slower than a pure-DB test file, that's normal.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/testing/testUser.ts src/lib/db/positions.ts src/lib/db/positions.test.ts
git commit -m "feat: add positions DB access layer and test-user helper"
```

---

### Task 3: Extend alerts for position-scoped alerts

**Files:**
- Modify: `src/lib/db/alerts.ts`
- Modify: `src/lib/db/alerts.test.ts`
- Modify: `src/lib/alerts/format.ts`
- Modify: `src/lib/alerts/format.test.ts`

**Interfaces:**
- Produces: `AlertType` now includes `'take_profit' | 'exit_warning'` (Task 4's `evaluatePositionAlerts` returns these). `NewAlertInput`/`AlertRecord` gain optional `userId?: string` / `positionId?: string` (and non-optional `userId: string | null` / `positionId: string | null` on the read side, `AlertRecord`). New `wasPositionRecentlyAlerted(positionId, alertType, cooldownMinutes?): Promise<boolean>`. `ALERT_LABELS` and `escapeMarkdown` (from `src/lib/alerts/format.ts`) become exported so Task 4's `src/lib/positions/format.ts` can reuse them rather than duplicating the label map or the Markdown-escaping regex.

- [ ] **Step 1: Write the failing tests — add to `src/lib/db/alerts.test.ts`**

Add these new test cases to the existing file (the existing tests for `insertAlert`/`wasRecentlyAlerted`/`markTelegramResult` stay as-is and must continue to pass unchanged):

```typescript
// add to src/lib/db/alerts.test.ts, inside/alongside the existing describe blocks
import { insertPosition } from './positions';
import { upsertToken as upsertTokenAgain } from './tokens'; // already imported in this file as `upsertToken` — do not add a duplicate import, reuse the existing one
import { createTestUser } from '../testing/testUser';
import { wasPositionRecentlyAlerted } from './alerts'; // add to the existing `from './alerts'` import instead of a new import line

describe('insertAlert with userId and positionId', () => {
  it('stores and returns userId and positionId when provided', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-1',
      pairAddress: 'pair-alert-pos-1',
      symbol: 'ALRTP1',
      name: 'Alert Position Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    expect(alert.userId).toBe(user.id);
    expect(alert.positionId).toBe(position.id);
  });

  it('leaves userId and positionId null when omitted (discovery alerts)', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-2',
      pairAddress: 'pair-alert-pos-2',
      symbol: 'ALRTP2',
      name: 'Alert Position Coin 2',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });

    expect(alert.userId).toBeNull();
    expect(alert.positionId).toBeNull();
  });
});

describe('wasPositionRecentlyAlerted', () => {
  it('finds an alert within the cooldown window for the same position and type', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-3',
      pairAddress: 'pair-alert-pos-3',
      symbol: 'ALRTP3',
      name: 'Alert Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'exit_warning',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    const recent = await wasPositionRecentlyAlerted(position.id, 'exit_warning', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(true);
  });

  it('does not find a cooldown hit for a different position on the same token', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-4',
      pairAddress: 'pair-alert-pos-4',
      symbol: 'ALRTP4',
      name: 'Alert Position Coin 4',
      initialLiquidityUsd: 50000,
    });
    const positionA = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });
    const positionB = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 2,
      entryMarketCap: 2_000_000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: positionA.id,
    });

    const recent = await wasPositionRecentlyAlerted(positionB.id, 'take_profit', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(false);
  });
});
```

(Read the existing `src/lib/db/alerts.test.ts` first — it already defines `fakeScore`, `fakePair`, imports `upsertToken`, `insertAlert`, `ALERT_COOLDOWN_MINUTES`, and has a `beforeEach` that truncates tables. Add `positions` to that `beforeEach`'s truncate list: `'truncate table alerts, positions, token_scores, token_snapshots, tokens cascade'`. Add the new imports at the top rather than duplicating existing ones.)

Add to `src/lib/alerts/format.test.ts` (existing tests stay unchanged):

```typescript
// add to src/lib/alerts/format.test.ts
it('has labels for all alert types including position alert types', () => {
  expect(formatAlertMessage('take_profit', makePair())).toContain('Take Profit');
  expect(formatAlertMessage('exit_warning', makePair())).toContain('Exit Warning');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- db/alerts.test
npm test -- alerts/format.test
```

Expected: both FAIL — `AlertType` doesn't include `'take_profit'`/`'exit_warning'` yet (TypeScript compile error), `wasPositionRecentlyAlerted` doesn't exist, `userId`/`positionId` aren't accepted by `insertAlert`.

- [ ] **Step 3: Modify `src/lib/db/alerts.ts`**

Replace the full contents:

```typescript
// src/lib/db/alerts.ts
import { getPool } from './pool';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';

export type AlertType =
  | 'buy_watch'
  | 'volume_spike'
  | 'liquidity_danger'
  | 'trend_break'
  | 'take_profit'
  | 'exit_warning';

export const ALERT_COOLDOWN_MINUTES = 30;

export interface AlertPayload {
  score: ScoreBreakdown;
  pair: DexScreenerPair;
}

export interface NewAlertInput {
  tokenId: string;
  alertType: AlertType;
  payload: AlertPayload;
  userId?: string;
  positionId?: string;
}

export interface AlertRecord {
  id: string;
  tokenId: string;
  alertType: AlertType;
  triggeredAt: string;
  payload: AlertPayload;
  telegramSent: boolean;
  telegramError: string | null;
  userId: string | null;
  positionId: string | null;
}

export async function wasRecentlyAlerted(
  tokenId: string,
  alertType: AlertType,
  cooldownMinutes: number = ALERT_COOLDOWN_MINUTES
): Promise<boolean> {
  const result = await getPool().query(
    `select 1 from alerts
     where token_id = $1 and alert_type = $2 and triggered_at > now() - make_interval(mins => $3)
     limit 1`,
    [tokenId, alertType, cooldownMinutes]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function wasPositionRecentlyAlerted(
  positionId: string,
  alertType: AlertType,
  cooldownMinutes: number = ALERT_COOLDOWN_MINUTES
): Promise<boolean> {
  const result = await getPool().query(
    `select 1 from alerts
     where position_id = $1 and alert_type = $2 and triggered_at > now() - make_interval(mins => $3)
     limit 1`,
    [positionId, alertType, cooldownMinutes]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertAlert(input: NewAlertInput): Promise<AlertRecord> {
  const result = await getPool().query(
    `insert into alerts (token_id, alert_type, payload, user_id, position_id)
     values ($1, $2, $3, $4, $5)
     returning id, token_id, alert_type, triggered_at, payload, telegram_sent, telegram_error, user_id, position_id`,
    [input.tokenId, input.alertType, JSON.stringify(input.payload), input.userId ?? null, input.positionId ?? null]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    tokenId: row.token_id,
    alertType: row.alert_type,
    triggeredAt: row.triggered_at.toISOString(),
    payload: row.payload,
    telegramSent: row.telegram_sent,
    telegramError: row.telegram_error,
    userId: row.user_id,
    positionId: row.position_id,
  };
}

export async function markTelegramResult(alertId: string, sent: boolean, error: string | null): Promise<void> {
  await getPool().query(`update alerts set telegram_sent = $2, telegram_error = $3 where id = $1`, [
    alertId,
    sent,
    error,
  ]);
}
```

- [ ] **Step 4: Modify `src/lib/alerts/format.ts`**

Replace the full contents:

```typescript
// src/lib/alerts/format.ts
import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

export const ALERT_LABELS: Record<AlertType, string> = {
  buy_watch: 'Buy Watch',
  volume_spike: 'Volume Spike',
  liquidity_danger: 'Liquidity Danger',
  trend_break: 'Trend Break',
  take_profit: 'Take Profit',
  exit_warning: 'Exit Warning',
};

export function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[]/g, '\\$&');
}

export function formatAlertMessage(alertType: AlertType, pair: DexScreenerPair): string {
  const label = ALERT_LABELS[alertType];
  const symbol = escapeMarkdown(pair.baseToken.symbol);
  const name = escapeMarkdown(pair.baseToken.name);
  const liquidity = (pair.liquidity?.usd ?? 0).toLocaleString('en-US');
  return [
    `*${label}*: ${symbol} (${name})`,
    `Price: $${pair.priceUsd}`,
    `Liquidity: $${liquidity}`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
```

(The only changes from the current file: `ALERT_LABELS` and `escapeMarkdown` are now `export`ed, and `ALERT_LABELS` has the two new entries. `formatAlertMessage`'s own body is unchanged.)

- [ ] **Step 5: Run the tests to verify they pass, then run the full suite**

```bash
npm test -- db/alerts.test
npm test -- alerts/format.test
npm test
```

Expected: all PASS, no regressions anywhere (Plan 1/2/3a's tests, plus this task's additions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/alerts.ts src/lib/db/alerts.test.ts src/lib/alerts/format.ts src/lib/alerts/format.test.ts
git commit -m "feat: extend alerts for position-scoped alerts (userId, positionId, wasPositionRecentlyAlerted)"
```

---

### Task 4: Position alert rules and message formatting

**Files:**
- Create: `src/lib/positions/rules.ts`
- Test: `src/lib/positions/rules.test.ts`
- Create: `src/lib/positions/format.ts`
- Test: `src/lib/positions/format.test.ts`

**Interfaces:**
- Consumes: `DexScreenerPair` (`src/lib/dexscreener/types.ts`), `ScoreBreakdown` (`src/lib/db/tokens.ts`), `AlertType` (`src/lib/db/alerts.ts`, Task 3), `PriorSnapshot` (`src/lib/scan/history.ts`, Plan 2), `getEffectiveMarketCap` (`src/lib/scan/filter.ts`, Plan 1, reused), `ALERT_LABELS`/`escapeMarkdown` (`src/lib/alerts/format.ts`, Task 3, reused).
- Produces:
  - `PositionAlertEvaluationInput { pair: DexScreenerPair; score: ScoreBreakdown; entryPrice: number; entryMarketCap: number; priorSnapshot: PriorSnapshot | null; localHighPrice: number | null }`
  - `evaluatePositionAlerts(input: PositionAlertEvaluationInput): AlertType[]` — pure function, no I/O.
  - `formatPositionAlertMessage(alertType: AlertType, pair: DexScreenerPair, entryPrice: number): string`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/positions/rules.test.ts
import { describe, expect, it } from 'vitest';
import { evaluatePositionAlerts } from './rules';
import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '1.00',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 50000, base: 1000, quote: 1000 },
    volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
    txns: {
      m5: { buys: 5, sells: 5 },
      h1: { buys: 50, sells: 50 },
      h6: { buys: 200, sells: 200 },
      h24: { buys: 500, sells: 500 },
    },
    marketCap: 1_000_000,
    fdv: 1_000_000,
    pairCreatedAt: Date.now() - 60 * 60 * 1000,
    ...overrides,
  };
}

function makeScore(overrides: Partial<ScoreBreakdown['factors']> = {}): ScoreBreakdown {
  const factors = {
    volumeMomentum: 0,
    liquidityGrowth: 0,
    priceStrength: 0,
    buySellRatio: 0,
    marketCapBand: 0,
    liquidityLevel: 0,
    wickRejection: 0,
    ...overrides,
  };
  const total = Object.values(factors).reduce((a, b) => a + b, 0);
  return { total, factors };
}

describe('evaluatePositionAlerts', () => {
  it('returns no alerts for a flat position with no history', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair(),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toEqual([]);
  });

  it('fires take_profit when price has doubled', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '2.00' }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('fires take_profit when market cap has doubled', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ marketCap: 2_000_000 }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('fires take_profit when volume is declining while price still rises', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 } }),
      score: makeScore({ volumeMomentum: -5 }),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('does not fire take_profit when nothing qualifies', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '1.10', marketCap: 1_100_000 }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).not.toContain('take_profit');
  });

  it('fires exit_warning when liquidity dropped 20% or more', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ liquidity: { usd: 40000, base: 1, quote: 1 } }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('exit_warning');
  });

  it('fires exit_warning when price is down 25% or more from the local high', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '0.74' }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: 1.0,
    });
    expect(fired).toContain('exit_warning');
  });

  it('fires exit_warning when volume collapses', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: -18 }),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('exit_warning');
  });

  it('does not fire exit_warning when nothing qualifies', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ liquidity: { usd: 48000, base: 1, quote: 1 } }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: 1.0,
    });
    expect(fired).not.toContain('exit_warning');
  });

  it('treats missing pair.liquidity as no liquidity signal, without crashing', () => {
    const pairWithoutLiquidity = makePair();
    delete (pairWithoutLiquidity as { liquidity?: unknown }).liquidity;
    const fired = evaluatePositionAlerts({
      pair: pairWithoutLiquidity,
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).not.toContain('exit_warning');
  });
});
```

```typescript
// src/lib/positions/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatPositionAlertMessage } from './format';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-pos-format',
    baseToken: { address: 'mint-pos-format', name: 'Position Format Coin', symbol: 'PFMT' },
    priceUsd: '2.00',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 100000, base: 1000, quote: 1000 },
    volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
    txns: {
      m5: { buys: 5, sells: 5 },
      h1: { buys: 50, sells: 50 },
      h6: { buys: 200, sells: 200 },
      h24: { buys: 500, sells: 500 },
    },
    marketCap: 2_000_000,
    fdv: 2_000_000,
    pairCreatedAt: Date.now() - 60 * 60 * 1000,
    ...overrides,
  };
}

describe('formatPositionAlertMessage', () => {
  it('includes the label, symbol, entry price, current price with percent change, and a dexscreener link', () => {
    const message = formatPositionAlertMessage('take_profit', makePair(), 1.0);
    expect(message).toContain('Take Profit');
    expect(message).toContain('PFMT');
    expect(message).toContain('Entry: $1');
    expect(message).toContain('$2.00');
    expect(message).toContain('+100.0%');
    expect(message).toContain('https://dexscreener.com/solana/pair-pos-format');
  });

  it('shows a negative percent change when price is down from entry', () => {
    const message = formatPositionAlertMessage('exit_warning', makePair({ priceUsd: '0.50' }), 1.0);
    expect(message).toContain('Exit Warning');
    expect(message).toContain('-50.0%');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- positions/rules.test
npm test -- positions/format.test
```

Expected: both FAIL — modules don't exist.

- [ ] **Step 3: Implement the position alert rules**

```typescript
// src/lib/positions/rules.ts
import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';
import type { AlertType } from '../db/alerts';
import type { PriorSnapshot } from '../scan/history';
import { getEffectiveMarketCap } from '../scan/filter';

export interface PositionAlertEvaluationInput {
  pair: DexScreenerPair;
  score: ScoreBreakdown;
  entryPrice: number;
  entryMarketCap: number;
  priorSnapshot: PriorSnapshot | null;
  localHighPrice: number | null;
}

const TAKE_PROFIT_PRICE_MULTIPLE = 2;
const TAKE_PROFIT_MARKET_CAP_MULTIPLE = 2;
const EXIT_WARNING_LIQUIDITY_DROP_RATIO = 0.2;
const EXIT_WARNING_PRICE_DROP_RATIO = 0.25;
const EXIT_WARNING_VOLUME_COLLAPSE_THRESHOLD = -15;

export function evaluatePositionAlerts(input: PositionAlertEvaluationInput): AlertType[] {
  const fired: AlertType[] = [];
  if (evaluatesTakeProfit(input)) fired.push('take_profit');
  if (evaluatesExitWarning(input)) fired.push('exit_warning');
  return fired;
}

function evaluatesTakeProfit(input: PositionAlertEvaluationInput): boolean {
  const currentPrice = parseFloat(input.pair.priceUsd);
  if (currentPrice >= input.entryPrice * TAKE_PROFIT_PRICE_MULTIPLE) return true;

  const currentMarketCap = getEffectiveMarketCap(input.pair);
  if (currentMarketCap !== undefined && currentMarketCap >= input.entryMarketCap * TAKE_PROFIT_MARKET_CAP_MULTIPLE) {
    return true;
  }

  if (input.score.factors.volumeMomentum < 0 && input.pair.priceChange.h1 > 0) return true;

  return false;
}

function evaluatesExitWarning(input: PositionAlertEvaluationInput): boolean {
  const { pair, priorSnapshot, localHighPrice, score } = input;

  const currentLiquidityUsd = pair.liquidity?.usd;
  if (priorSnapshot && priorSnapshot.liquidityUsd > 0 && currentLiquidityUsd !== undefined) {
    const liquidityDropRatio = (priorSnapshot.liquidityUsd - currentLiquidityUsd) / priorSnapshot.liquidityUsd;
    if (liquidityDropRatio >= EXIT_WARNING_LIQUIDITY_DROP_RATIO) return true;
  }

  if (localHighPrice && localHighPrice > 0) {
    const currentPrice = parseFloat(pair.priceUsd);
    const priceDropRatio = (localHighPrice - currentPrice) / localHighPrice;
    if (priceDropRatio >= EXIT_WARNING_PRICE_DROP_RATIO) return true;
  }

  if (score.factors.volumeMomentum <= EXIT_WARNING_VOLUME_COLLAPSE_THRESHOLD) return true;

  return false;
}
```

- [ ] **Step 4: Implement position alert message formatting**

```typescript
// src/lib/positions/format.ts
import { ALERT_LABELS, escapeMarkdown } from '../alerts/format';
import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

export function formatPositionAlertMessage(alertType: AlertType, pair: DexScreenerPair, entryPrice: number): string {
  const label = ALERT_LABELS[alertType];
  const symbol = escapeMarkdown(pair.baseToken.symbol);
  const currentPrice = parseFloat(pair.priceUsd);
  const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const changeText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`;
  return [
    `*${label}*: ${symbol}`,
    `Entry: $${entryPrice}`,
    `Current: $${pair.priceUsd} (${changeText})`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- positions/rules.test
npm test -- positions/format.test
```

Expected: PASS — 10 tests in `rules.test.ts`, 2 in `format.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/positions/rules.ts src/lib/positions/rules.test.ts src/lib/positions/format.ts src/lib/positions/format.test.ts
git commit -m "feat: add position alert rules and message formatting"
```

---

### Task 5: Position create/close routes, and extracting `selectPair`

**Files:**
- Modify: `src/lib/scan/filter.ts` — add `selectPair`
- Modify: `src/app/api/cron/scan/route.ts` — import `selectPair` instead of defining it locally
- Create: `src/app/api/positions/route.ts`
- Test: `src/app/api/positions/route.test.ts`
- Create: `src/app/api/positions/[id]/route.ts`
- Test: `src/app/api/positions/[id]/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (`src/lib/auth/getCurrentUser.ts`, Plan 3a), `fetchTokenPairs` (`src/lib/dexscreener/client.ts`, Plan 1), `getEffectiveMarketCap`/`selectPair` (`src/lib/scan/filter.ts`), `upsertToken` (`src/lib/db/tokens.ts`, Plan 1), `insertPosition`/`getPositionById`/`closePosition` (`src/lib/db/positions.ts`, Task 2).
- Produces: `POST /api/positions` (`201 { position: PositionRecord }` on success), `DELETE /api/positions/:id` (`200 { ok: true }` on success).

**Why `selectPair` moves:** `POST /api/positions` needs the same "prefer the pair matching this mint address, tie-broken by highest liquidity" logic Plan 1's cron route already built (and specifically fixed a real bug in — see Plan 1's final review). Rather than duplicate that logic a second time, it moves to `src/lib/scan/filter.ts` where `passesHardFilter`/`getEffectiveMarketCap` already live, and the cron scan route imports it instead of defining it locally. No behavior change to the existing route — this is a pure extraction.

- [ ] **Step 1: Move `selectPair` into `src/lib/scan/filter.ts`**

Add to the end of `src/lib/scan/filter.ts` (the existing `FilterThresholds`, `DEFAULT_FILTER_THRESHOLDS`, `getEffectiveMarketCap`, `passesHardFilter` stay exactly as they are):

```typescript
export function selectPair(pairs: DexScreenerPair[], tokenAddress: string): DexScreenerPair | undefined {
  const matching = pairs.filter((p) => p.baseToken.address === tokenAddress);
  const candidates = matching.length > 0 ? matching : pairs;
  return candidates.reduce<DexScreenerPair | undefined>((best, p) => {
    const pLiquidity = p.liquidity?.usd ?? 0;
    const bestLiquidity = best?.liquidity?.usd ?? 0;
    if (!best || pLiquidity > bestLiquidity) return p;
    return best;
  }, undefined);
}
```

- [ ] **Step 2: Update `src/app/api/cron/scan/route.ts` to import it**

Remove the local `function selectPair(...)` block (currently lines 15-24) entirely, and change the import line:

```typescript
import { passesHardFilter, selectPair } from '@/lib/scan/filter';
```

(replacing the current `import { passesHardFilter } from '@/lib/scan/filter';`). No other change to this file.

- [ ] **Step 3: Add a test for `selectPair` to `src/lib/scan/filter.test.ts`**

Add this test case (the existing `passesHardFilter`/`getEffectiveMarketCap` tests in this file are unchanged):

```typescript
// add to src/lib/scan/filter.test.ts
import { selectPair } from './filter'; // add to the existing `from './filter'` import

describe('selectPair', () => {
  it('prefers the pair matching the token address, tie-broken by highest liquidity', () => {
    const wrongTokenPair = makePair({
      baseToken: { address: 'mint-other', name: 'Other', symbol: 'OTHR' },
      liquidity: { usd: 20000, base: 1, quote: 1 },
    });
    const matchingPair = makePair({
      pairAddress: 'pair-matching',
      baseToken: { address: 'mint-target', name: 'Target', symbol: 'TGT' },
      liquidity: { usd: 5000, base: 1, quote: 1 },
    });

    const selected = selectPair([wrongTokenPair, matchingPair], 'mint-target');

    expect(selected?.pairAddress).toBe('pair-matching');
  });

  it('returns undefined for an empty array', () => {
    expect(selectPair([], 'mint-target')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the scan-route and filter tests to verify no regression**

```bash
npm test -- scan/filter.test
npm test -- cron/scan/route.test
```

Expected: both PASS — `filter.test.ts` grows by 2 tests; `cron/scan/route.test.ts`'s existing tests (including the one specifically testing pair-selection behavior) still pass unchanged, proving the extraction didn't change behavior.

- [ ] **Step 5: Write the failing tests for the position routes**

```typescript
// src/app/api/positions/route.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { createTestUser } from '@/lib/testing/testUser';
import { POST } from './route';

const mockGetCurrentUser = vi.fn();

vi.mock('@/lib/auth/getCurrentUser', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

beforeEach(async () => {
  mockGetCurrentUser.mockReset();
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closePool();
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/positions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/positions', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await POST(makeRequest({ mintAddress: 'mint-x', entryPrice: 1 }));
    expect(response.status).toBe(401);
  });

  it('returns 400 when mintAddress is missing', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    const response = await POST(makeRequest({ entryPrice: 1 }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when entryPrice is missing', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    const response = await POST(makeRequest({ mintAddress: 'mint-x' }));
    expect(response.status).toBe(400);
  });

  it('creates a position from a live DexScreener lookup', async () => {
    const user = await createTestUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id, email: user.email });

    const goodPair = {
      chainId: 'solana',
      pairAddress: 'pair-position-1',
      baseToken: { address: 'mint-position-1', name: 'Position Test Coin', symbol: 'PTC' },
      priceUsd: '0.005',
      priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
      liquidity: { usd: 60000, base: 1000, quote: 1000 },
      volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
      txns: {
        m5: { buys: 5, sells: 5 },
        h1: { buys: 50, sells: 50 },
        h6: { buys: 200, sells: 200 },
        h24: { buys: 500, sells: 500 },
      },
      marketCap: 1_500_000,
      fdv: 1_500_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('mint-position-1')) {
        return { ok: true, json: async () => [goodPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest({ mintAddress: 'mint-position-1', entryPrice: 0.005, amount: 1000 }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.position.userId).toBe(user.id);
    expect(body.position.entryPrice).toBe(0.005);
    expect(body.position.entryMarketCap).toBe(1_500_000);
    expect(body.position.amount).toBe(1000);

    const rows = await getPool().query('select * from tokens where mint_address = $1', ['mint-position-1']);
    expect(rows.rows).toHaveLength(1);
  });

  it('returns 400 when DexScreener has no pair for the mint address', async () => {
    const user = await createTestUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id, email: user.email });

    const mockFetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest({ mintAddress: 'mint-nonexistent', entryPrice: 1 }));
    expect(response.status).toBe(400);
  });
});
```

```typescript
// src/app/api/positions/[id]/route.test.ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { upsertToken } from '@/lib/db/tokens';
import { insertPosition } from '@/lib/db/positions';
import { createTestUser } from '@/lib/testing/testUser';
import { DELETE } from './route';

const mockGetCurrentUser = vi.fn();

vi.mock('@/lib/auth/getCurrentUser', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

beforeEach(async () => {
  mockGetCurrentUser.mockReset();
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/positions/some-id', { method: 'DELETE' });
}

describe('DELETE /api/positions/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'does-not-matter' }) });
    expect(response.status).toBe(401);
  });

  it('returns 404 when the position does not exist', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    const response = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 403 when the position belongs to a different user', async () => {
    const owner = await createTestUser();
    const otherUser = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-close-1',
      pairAddress: 'pair-close-1',
      symbol: 'CLOSE1',
      name: 'Close Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: owner.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    mockGetCurrentUser.mockResolvedValue({ id: otherUser.id, email: otherUser.email });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: position.id }) });
    expect(response.status).toBe(403);
  });

  it('closes the position when the owner requests it', async () => {
    const owner = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-close-2',
      pairAddress: 'pair-close-2',
      symbol: 'CLOSE2',
      name: 'Close Coin 2',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: owner.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    mockGetCurrentUser.mockResolvedValue({ id: owner.id, email: owner.email });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: position.id }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });

    const rows = await getPool().query('select closed_at from positions where id = $1', [position.id]);
    expect(rows.rows[0].closed_at).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
npm test -- api/positions/route.test
npm test -- 'api/positions/\[id\]/route.test'
```

Expected: both FAIL — route modules don't exist.

- [ ] **Step 7: Implement `POST /api/positions`**

```typescript
// src/app/api/positions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { getEffectiveMarketCap, selectPair } from '@/lib/scan/filter';
import { upsertToken } from '@/lib/db/tokens';
import { insertPosition } from '@/lib/db/positions';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: { mintAddress?: string; entryPrice?: number; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { mintAddress, entryPrice, amount } = body;
  if (!mintAddress || typeof entryPrice !== 'number') {
    return NextResponse.json({ error: 'mintAddress and entryPrice are required' }, { status: 400 });
  }

  let pairs;
  try {
    pairs = await fetchTokenPairs(mintAddress);
  } catch (err) {
    console.error(`positions: failed to fetch pairs for ${mintAddress}`, err);
    return NextResponse.json({ error: 'failed to look up token' }, { status: 400 });
  }

  const pair = selectPair(pairs, mintAddress);
  if (!pair) {
    return NextResponse.json({ error: 'no DexScreener pair found for that mint address' }, { status: 400 });
  }

  const entryMarketCap = getEffectiveMarketCap(pair);
  if (entryMarketCap === undefined) {
    return NextResponse.json({ error: 'token has no usable market cap data yet' }, { status: 400 });
  }

  const token = await upsertToken({
    mintAddress: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    initialLiquidityUsd: pair.liquidity?.usd ?? 0,
  });

  const position = await insertPosition({
    userId: user.id,
    tokenId: token.id,
    entryPrice,
    entryMarketCap,
    amount,
  });

  return NextResponse.json({ position }, { status: 201 });
}
```

- [ ] **Step 8: Implement `DELETE /api/positions/:id`**

```typescript
// src/app/api/positions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { closePosition, getPositionById } from '@/lib/db/positions';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const position = await getPositionById(id);

  if (!position) {
    return NextResponse.json({ error: 'position not found' }, { status: 404 });
  }

  if (position.userId !== user.id) {
    return NextResponse.json({ error: 'not authorized to close this position' }, { status: 403 });
  }

  await closePosition(id);

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 9: Run the tests to verify they pass, then run the full suite**

```bash
npm test -- api/positions/route.test
npm test -- 'api/positions/\[id\]/route.test'
npm test
```

Expected: all PASS — 5 tests in `positions/route.test.ts`, 4 in `positions/[id]/route.test.ts`, no regressions elsewhere.

- [ ] **Step 10: Commit**

```bash
git add src/lib/scan/filter.ts src/lib/scan/filter.test.ts src/app/api/cron/scan/route.ts src/app/api/positions/
git commit -m "feat: add position create/close routes, extract selectPair for reuse"
```

---

### Task 6: Position monitoring cron route and live verification

**Files:**
- Create: `src/app/api/cron/positions/route.ts`
- Test: `src/app/api/cron/positions/route.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5 (`getOpenPositions` from `src/lib/db/positions.ts`; `fetchTokenPairs` from Plan 1; `selectPair` from `src/lib/scan/filter.ts`; `mapPairToSnapshot`/`scoreToken`/`insertSnapshot`/`insertScore` from Plan 1; `getPriorSnapshot`/`getLocalHighPrice` from Plan 2; `evaluatePositionAlerts` from Task 4; `wasPositionRecentlyAlerted`/`insertAlert`/`markTelegramResult`/`ALERT_COOLDOWN_MINUTES` from Task 3; `formatPositionAlertMessage` from Task 4; `sendTelegramMessage` from Plan 2).
- Produces: `POST /api/cron/positions` — `{ processed: number; skipped: number; total: number; alertsFired: number }`. `alertsFired` counts position alerts that fired AND were successfully delivered to Telegram, same semantics as Plan 2's `/api/cron/scan`'s `alertsFired`.

This task also performs this plan's live end-to-end verification.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/cron/positions/route.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { upsertToken } from '@/lib/db/tokens';
import { closePosition, insertPosition } from '@/lib/db/positions';
import { createTestUser } from '@/lib/testing/testUser';
import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

beforeEach(async () => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = ORIGINAL_TELEGRAM_CHAT_ID;
  await closePool();
});

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/positions', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function telegramSuccessBranch(url: string): { ok: true; text: () => Promise<string> } | undefined {
  return url.includes('api.telegram.org') ? { ok: true, text: async () => '' } : undefined;
}

describe('POST /api/cron/positions', () => {
  it('rejects requests without the correct bearer token', async () => {
    const response = await POST(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });

  it('fails closed with a 500 if CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(makeRequest('Bearer undefined'));
    expect(response.status).toBe(500);
  });

  it('returns zero counts when there are no open positions', async () => {
    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 0, total: 0, alertsFired: 0 });
  });

  it('processes an open position, writes a snapshot, and fires a take_profit alert', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-1',
      pairAddress: 'pair-cronpos-1',
      symbol: 'CPOS1',
      name: 'Cron Position Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });

    const currentPair = {
      chainId: 'solana',
      pairAddress: 'pair-cronpos-1',
      baseToken: { address: 'mint-cronpos-1', name: 'Cron Position Coin 1', symbol: 'CPOS1' },
      priceUsd: '0.003',
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      liquidity: { usd: 50000, base: 1000, quote: 1000 },
      volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
      txns: {
        m5: { buys: 5, sells: 5 },
        h1: { buys: 50, sells: 50 },
        h6: { buys: 200, sells: 200 },
        h24: { buys: 500, sells: 500 },
      },
      marketCap: 1_500_000,
      fdv: 1_500_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('mint-cronpos-1')) {
        return { ok: true, json: async () => [currentPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    // priceUsd 0.003 is 3x entryPrice 0.001 -> take_profit fires on price alone;
    // exit_warning correctly does not fire (no prior snapshot, first-ever price
    // equals its own local high so drop ratio is 0, volumeMomentum is 0).
    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, skipped: 0, total: 1, alertsFired: 1 });

    const snapshots = await getPool().query('select * from token_snapshots where token_id = $1', [token.id]);
    expect(snapshots.rows).toHaveLength(1);

    const alerts = await getPool().query('select alert_type, user_id, position_id, telegram_sent from alerts');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].alert_type).toBe('take_profit');
    expect(alerts.rows[0].user_id).toBe(user.id);
    expect(alerts.rows[0].position_id).toBe(position.id);
    expect(alerts.rows[0].telegram_sent).toBe(true);
  });

  it('does not process a closed position', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-2',
      pairAddress: 'pair-cronpos-2',
      symbol: 'CPOS2',
      name: 'Cron Position Coin 2',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });
    await closePosition(position.id);

    const mockFetch = vi.fn(async () => {
      throw new Error('should not be called for a closed position');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 0, total: 0, alertsFired: 0 });
  });

  it('skips a position whose pair fetch throws, without failing the whole tick', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-3',
      pairAddress: 'pair-cronpos-3',
      symbol: 'CPOS3',
      name: 'Cron Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });

    const mockFetch = vi.fn(async () => {
      throw new Error('network error');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 1, total: 1, alertsFired: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- cron/positions/route.test
```

Expected: FAIL — `./route` module doesn't exist.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/cron/positions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { selectPair } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { insertSnapshot, insertScore } from '@/lib/db/tokens';
import type { ScoreBreakdown } from '@/lib/db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from '@/lib/scan/history';
import { evaluatePositionAlerts } from '@/lib/positions/rules';
import { wasPositionRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from '@/lib/db/alerts';
import { formatPositionAlertMessage } from '@/lib/positions/format';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { getOpenPositions } from '@/lib/db/positions';
import type { OpenPosition } from '@/lib/db/positions';
import type { DexScreenerPair } from '@/lib/dexscreener/types';

async function evaluateAndDeliverPositionAlerts(
  position: OpenPosition,
  pair: DexScreenerPair,
  score: ScoreBreakdown
): Promise<number> {
  const [priorSnapshot, localHighPrice] = await Promise.all([
    getPriorSnapshot(position.tokenId),
    getLocalHighPrice(position.tokenId),
  ]);

  const firedTypes = evaluatePositionAlerts({
    pair,
    score,
    entryPrice: position.entryPrice,
    entryMarketCap: position.entryMarketCap,
    priorSnapshot,
    localHighPrice,
  });

  let delivered = 0;

  for (const alertType of firedTypes) {
    const inCooldown = await wasPositionRecentlyAlerted(position.id, alertType, ALERT_COOLDOWN_MINUTES);
    if (inCooldown) continue;

    const alert = await insertAlert({
      tokenId: position.tokenId,
      alertType,
      payload: { score, pair },
      userId: position.userId,
      positionId: position.id,
    });

    try {
      await sendTelegramMessage(formatPositionAlertMessage(alertType, pair, position.entryPrice));
      await markTelegramResult(alert.id, true, null);
      delivered++;
    } catch (err) {
      console.error(`position alert: telegram send failed for ${alertType} on position ${position.id}`, err);
      await markTelegramResult(alert.id, false, (err as Error).message);
    }
  }

  return delivered;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('positions: CRON_SECRET is not configured');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const positions = await getOpenPositions();

  let processed = 0;
  let skipped = 0;
  let alertsFired = 0;

  for (const position of positions) {
    try {
      const pairs = await fetchTokenPairs(position.mintAddress);
      const pair = selectPair(pairs, position.mintAddress);

      if (!pair) {
        skipped++;
        continue;
      }

      const snapshot = mapPairToSnapshot(pair);
      const snapshotId = await insertSnapshot(position.tokenId, snapshot);
      const score = scoreToken({ pair, initialLiquidityUsd: position.initialLiquidityUsd });
      await insertScore(snapshotId, score);
      processed++;

      try {
        alertsFired += await evaluateAndDeliverPositionAlerts(position, pair, score);
      } catch (err) {
        console.error(`positions: alert evaluation failed for position ${position.id}`, err);
      }
    } catch (err) {
      console.error(`positions: failed to process position ${position.id}`, err);
      skipped++;
    }
  }

  return NextResponse.json({ processed, skipped, total: positions.length, alertsFired });
}
```

Note the same error-isolation shape as Plan 1/2's cron route: `processed++` happens before alert evaluation runs, and alert evaluation/delivery has its own inner try/catch — a failure there can never turn a successfully-scored position into a `skipped` one.

- [ ] **Step 4: Run the tests to verify they pass, then run the full suite**

```bash
npm test -- cron/positions/route.test
npm test
```

Expected: all PASS — 6 tests in this file, no regressions anywhere else.

- [ ] **Step 5: Manual end-to-end verification against the live DexScreener API and real Telegram**

Requires `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` in `.env.local` — reuse the same bot from Plan 2's live verification (do not put the actual token/chat ID value in this plan document or in any commit; if you no longer have it, create a fresh one following Plan 2's Task 1 steps).

```bash
npm run dev
```

In another terminal, sign up/log in to get a session cookie, then create a position with a deliberately very low entry price — this guarantees Take Profit's "price doubled" condition fires on the very next tick, without needing to hack any thresholds:

```bash
curl -s -c /tmp/alpharadar-cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"positions-test@example.com","password":"testpassword123"}'

curl -s -c /tmp/alpharadar-cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"positions-test@example.com","password":"testpassword123"}'
```

Pick any real, currently-active Solana mint address (e.g. one that showed up in Plan 1/2's own live verification output, or look one up on dexscreener.com/solana), then:

```bash
curl -s -b /tmp/alpharadar-cookies.txt -X POST http://localhost:3000/api/positions \
  -H "Content-Type: application/json" \
  -d '{"mintAddress":"<a real Solana mint address>","entryPrice":0.0000001}'
```

Expected: `201` with the created position (its `entryPrice` will be far below the token's real current price, guaranteeing Take Profit fires).

```bash
CRON_SECRET=$(grep CRON_SECRET .env.local | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/cron/positions -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `{"processed":1,"skipped":0,"total":1,"alertsFired":1}`. Check your Telegram chat with the bot — a `*Take Profit*` message should arrive within a few seconds, tagged with the token symbol, entry price, and a large positive percent change. Then confirm the DB:

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "select alert_type, user_id, position_id, telegram_sent from alerts order by triggered_at desc limit 5;"
```

Expected: one `take_profit` row with `telegram_sent = true`, `user_id`/`position_id` populated matching what you created.

Stop the dev server when done (`kill` the background process or Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/positions/
git commit -m "feat: add position monitoring cron route"
```

---

## Self-Review Notes

- **Spec coverage:** Position creation (any mint address, live lookup), soft-close, Take Profit and Exit Warning with concrete rule definitions, delivery via Plan 2's shared Telegram chat, and monitoring independent of discovery-scan trending status are all covered. Per-user Telegram linking is explicitly out of scope, per the design doc's Scope Note.
- **Cross-task consistency:** `AlertType`'s two new members are defined once (Task 3, `src/lib/db/alerts.ts`) and immediately propagate everywhere `Record<AlertType, ...>` is exhaustively checked (`ALERT_LABELS` in `src/lib/alerts/format.ts`, also updated in Task 3) — this is intentional: TypeScript's exhaustiveness checking on `Record<AlertType, string>` is what forces `format.ts` to be updated in the same task that extends the type, rather than silently drifting.
- **Known refactor:** `selectPair` moves from a private function inside Plan 1's cron scan route into the shared `src/lib/scan/filter.ts`, because Task 5's position-creation route needs the exact same pair-selection logic Plan 1's final review already hardened. This is a pure extraction (Task 5, Step 4 explicitly verifies the scan route's existing tests still pass unchanged) — not a behavior change.
- **Test-fixture note:** `createTestUser` (Task 2) makes real calls to local Supabase Auth rather than mocking it, matching this project's established "real local services, no mocking our own infra" philosophy from Plans 1-3a. It does not go through Plan 3a's cookie-aware client, since plain Vitest tests have no HTTP request/cookie context to give it.
