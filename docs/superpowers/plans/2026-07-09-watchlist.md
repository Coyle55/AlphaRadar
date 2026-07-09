# Watchlist / Positions UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/positions` page where a logged-in user can log a position, see their open positions with live P&L, and close a position with a real exit price — turning Plan 3b's write-only positions API into something usable.

**Architecture:** Three tasks: first, teach the backend to capture a real exit price when a position closes (a migration, a `closePosition` signature change, and extending the existing `DELETE /api/positions/[id]` route); second, add the two new read functions the page needs (a user's open positions with live current price, and their closed positions with realized P&L); third, build the page itself (log form, open/closed tables, inline close, a new nav link) and verify it end to end.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, `pg` direct SQL, Vitest. No new dependencies.

## Global Constraints

- No new colors, fonts, or signature elements — reuses the existing dark terminal `@theme` tokens and IBM Plex fonts exactly as they exist today.
- All numeric/monetary data renders in `font-mono`.
- `signal-green`/`signal-red` are reserved for P&L-sign semantics on this page (price up/down elsewhere) — never arbitrary accents.
- `exitPrice` is always user-entered (a real fill price, matching how `entryPrice` already works) — `exitMarketCap` is always auto-fetched live from DexScreener for context, matching how `entryMarketCap` already works. Never invert this.
- The `/positions` page lives inside the existing `(app)` route group and must NOT add its own `getCurrentUser()`/`redirect()` auth check beyond what's needed to get the user's `id` for scoping queries — the route group's layout already gates unauthenticated access.
- `getOpenPositionsForUser`/`getClosedPositionsForUser` must scope strictly by `user_id` — a position never appears for any user other than its owner. This is the one place in the app so far that reads genuinely per-user data (discovery feed and Coin Detail are both public market data to any authenticated user).
- DB-touching functions and API routes are tested against real local Postgres / with `fetch` mocked via `vi.stubGlobal`, same as every prior plan. The page itself is verified live via curl against the real dev server — no browser-automation tooling exists in this project.
- Node 23.x, TypeScript strict mode, Next.js App Router only.

---

## File Structure

- `supabase/migrations/0008_positions_exit_columns.sql` — new
- `src/lib/db/tokens.ts` — modified: add `getTokenById`
- `src/lib/db/positions.ts` — modified: `closePosition` gains `exitPrice`/`exitMarketCap` params, `PositionRecord` gains `exitPrice`/`exitMarketCap` fields, add `getOpenPositionsForUser`/`getClosedPositionsForUser`
- `src/lib/db/positions.test.ts` — modified: update existing `closePosition` call sites, add new test suites
- `src/app/api/positions/[id]/route.ts` — modified: require `exitPrice` in the request body, live DexScreener lookup for `exitMarketCap`
- `src/app/api/positions/[id]/route.test.ts` — modified: update `makeRequest` for a body, add new tests
- `src/app/(app)/layout.tsx` — modified: add "Discovery"/"Positions" nav links
- `src/app/(app)/positions/page.tsx` — new
- `src/components/LogPositionForm.tsx` — new
- `src/components/OpenPositionRow.tsx` — new

---

### Task 1: Exit price on close

**Files:**
- Create: `supabase/migrations/0008_positions_exit_columns.sql`
- Modify: `src/lib/db/tokens.ts`
- Modify: `src/lib/db/positions.ts`
- Modify: `src/lib/db/positions.test.ts`
- Modify: `src/app/api/positions/[id]/route.ts`
- Modify: `src/app/api/positions/[id]/route.test.ts`

**Interfaces:**
- Consumes: `fetchTokenPairs` (`src/lib/dexscreener/client.ts`), `selectPair`/`getEffectiveMarketCap` (`src/lib/scan/filter.ts`) — all pre-existing.
- Produces: `getTokenById(id: string): Promise<TokenRecord | null>`. `closePosition(id: string, exitPrice: number, exitMarketCap: number): Promise<void>` (signature change — was `closePosition(id: string)`). `PositionRecord` gains `exitPrice: number | null` and `exitMarketCap: number | null`.

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/0008_positions_exit_columns.sql
alter table positions add column exit_price numeric;
alter table positions add column exit_market_cap numeric;
```

Apply it: `npx supabase db reset` (or however this project's migrations are normally applied locally — check `package.json` scripts first; if none, `npx supabase migration up`).

- [ ] **Step 2: Add `getTokenById` to `src/lib/db/tokens.ts`**

Add this function anywhere in the file (e.g. just after `upsertToken`):

```typescript
export async function getTokenById(id: string): Promise<TokenRecord | null> {
  const result = await getPool().query(
    `select id, mint_address, pair_address, symbol, name, initial_liquidity_usd from tokens where id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    mintAddress: row.mint_address,
    pairAddress: row.pair_address,
    symbol: row.symbol,
    name: row.name,
    initialLiquidityUsd: Number(row.initial_liquidity_usd),
  };
}
```

- [ ] **Step 3: Update `src/lib/db/positions.ts`**

Replace the file with:

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
  exitPrice: number | null;
  exitMarketCap: number | null;
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

export interface OpenPositionWithPrice {
  id: string;
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  entryMarketCap: number;
  amount: number | null;
  openedAt: string;
  currentPriceUsd: number | null;
  currentPriceCapturedAt: string | null;
}

export interface ClosedPositionSummary {
  id: string;
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  exitPrice: number;
  openedAt: string;
  closedAt: string;
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
    exitPrice: row.exit_price === null ? null : Number(row.exit_price),
    exitMarketCap: row.exit_market_cap === null ? null : Number(row.exit_market_cap),
  };
}

export async function insertPosition(input: NewPositionInput): Promise<PositionRecord> {
  const result = await getPool().query(
    `insert into positions (user_id, token_id, entry_price, entry_market_cap, amount)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at, exit_price, exit_market_cap`,
    [input.userId, input.tokenId, input.entryPrice, input.entryMarketCap, input.amount ?? null]
  );
  return mapPositionRow(result.rows[0]);
}

export async function getPositionById(id: string): Promise<PositionRecord | null> {
  const result = await getPool().query(
    `select id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at, exit_price, exit_market_cap
     from positions where id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return mapPositionRow(result.rows[0]);
}

export async function closePosition(id: string, exitPrice: number, exitMarketCap: number): Promise<void> {
  await getPool().query(
    `update positions set closed_at = now(), exit_price = $2, exit_market_cap = $3 where id = $1`,
    [id, exitPrice, exitMarketCap]
  );
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

export async function getOpenPositionsForUser(userId: string): Promise<OpenPositionWithPrice[]> {
  const result = await getPool().query(
    `select p.id, p.token_id, t.mint_address, t.symbol, t.name,
            p.entry_price, p.entry_market_cap, p.amount, p.opened_at,
            latest.price_usd as current_price_usd, latest.captured_at as current_captured_at
     from positions p
     join tokens t on t.id = p.token_id
     left join lateral (
       select price_usd, captured_at
       from token_snapshots s
       where s.token_id = p.token_id
       order by s.captured_at desc
       limit 1
     ) latest on true
     where p.user_id = $1 and p.closed_at is null
     order by p.opened_at desc`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    amount: row.amount === null ? null : Number(row.amount),
    openedAt: row.opened_at.toISOString(),
    currentPriceUsd: row.current_price_usd === null ? null : Number(row.current_price_usd),
    currentPriceCapturedAt: row.current_captured_at === null ? null : row.current_captured_at.toISOString(),
  }));
}

export async function getClosedPositionsForUser(userId: string): Promise<ClosedPositionSummary[]> {
  const result = await getPool().query(
    `select p.id, p.token_id, t.mint_address, t.symbol, t.name,
            p.entry_price, p.exit_price, p.opened_at, p.closed_at
     from positions p
     join tokens t on t.id = p.token_id
     where p.user_id = $1 and p.closed_at is not null
     order by p.closed_at desc`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at.toISOString(),
  }));
}
```

`getOpenPositionsForUser`'s `left join lateral ... on true` is the standard Postgres idiom for "join the latest matching row, but keep this row even if there's no match" — a plain `DISTINCT ON` can't express the "keep unmatched rows" part, which matters here since a position's token might have zero snapshots.

`ClosedPositionSummary.exitPrice` is typed as a non-nullable `number`, not `number | null`: every row this function returns has `closed_at is not null`, and after this task, `closePosition` always sets `exit_price` in the same statement as `closed_at` — so a closed position with a null `exit_price` cannot be produced going forward. (See Self-Review Notes for the one theoretical way this invariant could already be violated in an existing local dev database.)

- [ ] **Step 4: Update `src/lib/db/positions.test.ts`**

The existing `closePosition` test and the `getOpenPositions` test both call `closePosition` with the old one-argument signature — update both call sites, and update the `closePosition` describe block to assert the new columns. Replace the `describe('closePosition', ...)` block with:

```typescript
describe('closePosition', () => {
  it('sets closedAt, exitPrice, and exitMarketCap', async () => {
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

    await closePosition(position.id, 0.0015, 1_500_000);

    const fetched = await getPositionById(position.id);
    expect(fetched?.closedAt).not.toBeNull();
    expect(fetched?.exitPrice).toBe(0.0015);
    expect(fetched?.exitMarketCap).toBe(1_500_000);
  });
});
```

And in the `describe('getOpenPositions', ...)` test, change:

```typescript
    await closePosition(closedPositionRecord.id);
```

to:

```typescript
    await closePosition(closedPositionRecord.id, 0.003, 3_000_000);
```

- [ ] **Step 5: Run the existing positions tests to confirm they still pass**

```bash
npm test -- db/positions.test
```

Expected: PASS, all tests (the two updated call sites plus the new assertions).

- [ ] **Step 6: Update `src/app/api/positions/[id]/route.ts`**

Replace the file with:

```typescript
// src/app/api/positions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { getEffectiveMarketCap, selectPair } from '@/lib/scan/filter';
import { getTokenById } from '@/lib/db/tokens';
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

  let body: { exitPrice?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { exitPrice } = body;
  if (typeof exitPrice !== 'number' || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return NextResponse.json(
      { error: 'exitPrice is required and must be a positive number' },
      { status: 400 }
    );
  }

  const token = await getTokenById(position.tokenId);
  if (!token) {
    return NextResponse.json({ error: 'token not found for this position' }, { status: 400 });
  }

  let pairs;
  try {
    pairs = await fetchTokenPairs(token.mintAddress);
  } catch (err) {
    console.error(`positions: failed to fetch pairs for ${token.mintAddress}`, err);
    return NextResponse.json({ error: 'failed to look up token' }, { status: 400 });
  }

  const pair = selectPair(pairs, token.mintAddress);
  if (!pair) {
    return NextResponse.json({ error: 'no DexScreener pair found for that mint address' }, { status: 400 });
  }

  const exitMarketCap = getEffectiveMarketCap(pair);
  if (exitMarketCap === undefined) {
    return NextResponse.json({ error: 'token has no usable market cap data yet' }, { status: 400 });
  }

  await closePosition(id, exitPrice, exitMarketCap);

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 7: Update `src/app/api/positions/[id]/route.test.ts`**

Replace the file with:

```typescript
// src/app/api/positions/[id]/route.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closePool();
});

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/positions/some-id', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('DELETE /api/positions/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await DELETE(makeRequest({ exitPrice: 1 }), {
      params: Promise.resolve({ id: 'does-not-matter' }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 when the position does not exist', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    const response = await DELETE(makeRequest({ exitPrice: 1 }), {
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

    const response = await DELETE(makeRequest({ exitPrice: 1 }), {
      params: Promise.resolve({ id: position.id }),
    });
    expect(response.status).toBe(403);
  });

  it('returns 400 when exitPrice is missing', async () => {
    const owner = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-close-noprice',
      pairAddress: 'pair-close-noprice',
      symbol: 'NOPRICE',
      name: 'No Price Coin',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: owner.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    mockGetCurrentUser.mockResolvedValue({ id: owner.id, email: owner.email });

    const response = await DELETE(makeRequest({}), { params: Promise.resolve({ id: position.id }) });
    expect(response.status).toBe(400);
  });

  it('returns 400 when exitPrice is zero or negative', async () => {
    const owner = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-close-badprice',
      pairAddress: 'pair-close-badprice',
      symbol: 'BADPRICE',
      name: 'Bad Price Coin',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: owner.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    mockGetCurrentUser.mockResolvedValue({ id: owner.id, email: owner.email });

    const response = await DELETE(makeRequest({ exitPrice: -1 }), {
      params: Promise.resolve({ id: position.id }),
    });
    expect(response.status).toBe(400);
  });

  it('closes the position with a live-fetched exit market cap when the owner requests it', async () => {
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

    const goodPair = {
      chainId: 'solana',
      pairAddress: 'pair-close-2',
      baseToken: { address: 'mint-close-2', name: 'Close Coin 2', symbol: 'CLOSE2' },
      priceUsd: '1.5',
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
      if (url.includes('mint-close-2')) {
        return { ok: true, json: async () => [goodPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await DELETE(makeRequest({ exitPrice: 1.5 }), {
      params: Promise.resolve({ id: position.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });

    const rows = await getPool().query(
      'select closed_at, exit_price, exit_market_cap from positions where id = $1',
      [position.id]
    );
    expect(rows.rows[0].closed_at).not.toBeNull();
    expect(Number(rows.rows[0].exit_price)).toBe(1.5);
    expect(Number(rows.rows[0].exit_market_cap)).toBe(1_500_000);
  });

  it('returns 400 when DexScreener has no pair for the token', async () => {
    const owner = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-close-nolookup',
      pairAddress: 'pair-close-nolookup',
      symbol: 'NOLOOKUP',
      name: 'No Lookup Coin',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: owner.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    mockGetCurrentUser.mockResolvedValue({ id: owner.id, email: owner.email });

    const mockFetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await DELETE(makeRequest({ exitPrice: 1 }), {
      params: Promise.resolve({ id: position.id }),
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 8: Run the route tests**

```bash
npm test -- api/positions/\\[id\\]/route.test
```

Expected: PASS, all 7 tests.

- [ ] **Step 9: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass (a re-run may be needed if you hit the project's known pre-existing flaky parallel-table-truncation issue in unrelated test files — not something to fix here).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/0008_positions_exit_columns.sql src/lib/db/tokens.ts src/lib/db/positions.ts src/lib/db/positions.test.ts "src/app/api/positions/[id]/route.ts" "src/app/api/positions/[id]/route.test.ts"
git commit -m "feat: capture exit price and market cap when closing a position"
```

---

### Task 2: Read functions for the Watchlist page

This task's functions (`getOpenPositionsForUser`, `getClosedPositionsForUser`) were already implemented in Task 1's rewrite of `src/lib/db/positions.ts`, since both live in the same file as the `closePosition` signature change. This task adds their tests.

**Files:**
- Modify: `src/lib/db/positions.test.ts`

**Interfaces:**
- Consumes: `getOpenPositionsForUser`, `getClosedPositionsForUser` (Task 1), `createTestUser` (`src/lib/testing/testUser.ts`), `insertPosition`/`closePosition`/`upsertToken`/`insertSnapshot`.

- [ ] **Step 1: Write the failing tests**

Append these two `describe` blocks to `src/lib/db/positions.test.ts` (after the existing `describe('getOpenPositions', ...)` block), and add `getOpenPositionsForUser`, `getClosedPositionsForUser`, and `insertSnapshot` to the existing imports at the top of the file:

```typescript
import { insertSnapshot, upsertToken } from './tokens';
import {
  closePosition,
  getClosedPositionsForUser,
  getOpenPositions,
  getOpenPositionsForUser,
  getPositionById,
  insertPosition,
} from './positions';
```

```typescript
describe('getOpenPositionsForUser', () => {
  it('returns an empty array for a user with no positions', async () => {
    const user = await createTestUser();
    const positions = await getOpenPositionsForUser(user.id);
    expect(positions).toEqual([]);
  });

  it('includes current price from the latest snapshot when one exists', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-1',
      pairAddress: 'pair-watch-1',
      symbol: 'WATCH1',
      name: 'Watch Coin 1',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
      amount: 500,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.0015,
      liquidityUsd: 60000,
      volume1hUsd: 5000,
      volume24hUsd: 20000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 1_500_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('WATCH1');
    expect(positions[0].currentPriceUsd).toBe(0.0015);
    expect(positions[0].amount).toBe(500);
  });

  it('returns null current price when the token has never been scanned', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-2',
      pairAddress: 'pair-watch-2',
      symbol: 'WATCH2',
      name: 'Watch Coin 2',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].currentPriceUsd).toBeNull();
    expect(positions[0].currentPriceCapturedAt).toBeNull();
  });

  it('excludes closed positions and positions belonging to other users', async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-watch-3',
      pairAddress: 'pair-watch-3',
      symbol: 'WATCH3',
      name: 'Watch Coin 3',
      initialLiquidityUsd: 50000,
    });
    const closedToken = await upsertToken({
      mintAddress: 'mint-watch-4',
      pairAddress: 'pair-watch-4',
      symbol: 'WATCH4',
      name: 'Watch Coin 4',
      initialLiquidityUsd: 50000,
    });
    const otherToken = await upsertToken({
      mintAddress: 'mint-watch-5',
      pairAddress: 'pair-watch-5',
      symbol: 'WATCH5',
      name: 'Watch Coin 5',
      initialLiquidityUsd: 50000,
    });

    const open = await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const closed = await insertPosition({
      userId: user.id,
      tokenId: closedToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(closed.id, 0.002, 2_000_000);
    await insertPosition({
      userId: otherUser.id,
      tokenId: otherToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].id).toBe(open.id);
  });
});

describe('getClosedPositionsForUser', () => {
  it('returns an empty array for a user with no closed positions', async () => {
    const user = await createTestUser();
    const positions = await getClosedPositionsForUser(user.id);
    expect(positions).toEqual([]);
  });

  it('returns realized entry/exit prices for a closed position', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-6',
      pairAddress: 'pair-watch-6',
      symbol: 'WATCH6',
      name: 'Watch Coin 6',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(position.id, 0.0025, 2_500_000);

    const positions = await getClosedPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('WATCH6');
    expect(positions[0].entryPrice).toBe(0.001);
    expect(positions[0].exitPrice).toBe(0.0025);
  });

  it('excludes open positions and positions belonging to other users', async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-watch-7',
      pairAddress: 'pair-watch-7',
      symbol: 'WATCH7',
      name: 'Watch Coin 7',
      initialLiquidityUsd: 50000,
    });
    const otherToken = await upsertToken({
      mintAddress: 'mint-watch-8',
      pairAddress: 'pair-watch-8',
      symbol: 'WATCH8',
      name: 'Watch Coin 8',
      initialLiquidityUsd: 50000,
    });

    await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const otherPosition = await insertPosition({
      userId: otherUser.id,
      tokenId: otherToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(otherPosition.id, 0.002, 2_000_000);

    const positions = await getClosedPositionsForUser(user.id);

    expect(positions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- db/positions.test
```

Expected: PASS, all tests (the pre-existing ones from Task 1 plus these 6 new ones).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/positions.test.ts
git commit -m "test: add coverage for per-user open and closed position queries"
```

---

### Task 3: The Watchlist page

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Create: `src/components/LogPositionForm.tsx`
- Create: `src/components/OpenPositionRow.tsx`
- Create: `src/app/(app)/positions/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (Plan 3a), `getOpenPositionsForUser`/`getClosedPositionsForUser` (Task 1/2), `formatUsd`/`timeAgo` (Plan Coin Detail's `src/lib/format.ts`), the existing `POST /api/positions` and the extended `DELETE /api/positions/[id]` (Task 1).

- [ ] **Step 1: Add nav links to the protected layout**

Replace `src/app/(app)/layout.tsx` with:

```typescript
// src/app/(app)/layout.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { AccountMenu } from "@/components/AccountMenu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
        <nav className="flex items-center gap-6">
          <span className="font-mono text-lg tracking-wide text-amber">ALPHARADAR</span>
          <Link href="/" className="text-sm text-ink/60 hover:text-amber">
            Discovery
          </Link>
          <Link href="/positions" className="text-sm text-ink/60 hover:text-amber">
            Positions
          </Link>
        </nav>
        <AccountMenu email={user.email} />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create the log-position form**

```typescript
// src/components/LogPositionForm.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LogPositionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mintAddress, setMintAddress] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAddress,
        entryPrice: Number(entryPrice),
        amount: amount === "" ? undefined : Number(amount),
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    setMintAddress("");
    setEntryPrice("");
    setAmount("");
    setSubmitting(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 border border-ink/20 px-4 py-2 text-sm text-ink/70 hover:border-amber hover:text-amber"
      >
        + Log Position
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3 border border-ink/20 bg-panel p-4">
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Mint Address
        <input
          required
          value={mintAddress}
          onChange={(e) => setMintAddress(e.target.value)}
          className="w-64 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Entry Price (USD)
        <input
          required
          type="number"
          step="any"
          min="0"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          className="w-32 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Amount (optional)
        <input
          type="number"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-amber px-4 py-2 font-medium text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Logging…" : "Log Position"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-ink/50 hover:text-ink">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-signal-red">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Create the open-position row (with inline close)**

```typescript
// src/components/OpenPositionRow.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatUsd } from "@/lib/format";

export interface OpenPositionRowData {
  id: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  amount: number | null;
  openedAt: string;
  currentPriceUsd: number | null;
  currentPriceCapturedAt: string | null;
}

export function OpenPositionRow({ position }: { position: OpenPositionRowData }) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [exitPrice, setExitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pnlPercent =
    position.currentPriceUsd === null
      ? null
      : ((position.currentPriceUsd - position.entryPrice) / position.entryPrice) * 100;

  async function handleClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = Number(exitPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive exit price");
      return;
    }

    setSubmitting(true);
    const response = await fetch(`/api/positions/${position.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exitPrice: parsed }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.refresh();
  }

  return (
    <tr className="border-b border-ink/5">
      <td className="py-3 pr-4">
        <div className="font-medium text-ink">{position.symbol}</div>
        <div className="text-xs text-ink/40">{position.name}</div>
      </td>
      <td className="py-3 pr-4 text-right">{formatUsd(position.entryPrice)}</td>
      <td className="py-3 pr-4 text-right">
        {position.currentPriceUsd === null ? (
          <span className="text-ink/40">—</span>
        ) : (
          formatUsd(position.currentPriceUsd)
        )}
      </td>
      <td className="py-3 pr-4 text-right">
        {pnlPercent === null ? (
          <span className="text-ink/40">—</span>
        ) : (
          <span className={pnlPercent >= 0 ? "text-signal-green" : "text-signal-red"}>
            {pnlPercent >= 0 ? "+" : ""}
            {pnlPercent.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-right">
        {position.amount === null ? <span className="text-ink/40">—</span> : position.amount}
      </td>
      <td className="py-3 pr-4 text-right text-ink/50">{new Date(position.openedAt).toLocaleDateString()}</td>
      <td className="py-3 text-right">
        {closing ? (
          <form onSubmit={handleClose} className="flex items-center justify-end gap-2">
            <input
              autoFocus
              type="number"
              step="any"
              min="0"
              placeholder="Exit price"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              className="w-24 rounded border border-ink/20 bg-terminal px-2 py-1 font-mono text-xs text-ink outline-none focus:border-amber"
            />
            <button
              type="submit"
              disabled={submitting}
              className="text-xs text-signal-green hover:opacity-80 disabled:opacity-50"
            >
              {submitting ? "…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setClosing(false);
                setError(null);
              }}
              className="text-xs text-ink/50 hover:text-ink"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button onClick={() => setClosing(true)} className="text-xs text-ink/50 hover:text-signal-red">
            Close
          </button>
        )}
        {error && <div className="mt-1 text-xs text-signal-red">{error}</div>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Create the Watchlist page**

```typescript
// src/app/(app)/positions/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getClosedPositionsForUser, getOpenPositionsForUser } from "@/lib/db/positions";
import { formatUsd } from "@/lib/format";
import { LogPositionForm } from "@/components/LogPositionForm";
import { OpenPositionRow } from "@/components/OpenPositionRow";

export default async function PositionsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [openPositions, closedPositions] = await Promise.all([
    getOpenPositionsForUser(user.id),
    getClosedPositionsForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <LogPositionForm />

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Open Positions</h2>
        {openPositions.length === 0 ? (
          <p className="text-sm text-ink/50">No open positions yet — log one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse font-mono text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                  <th className="py-2 pr-4 font-normal">Token</th>
                  <th className="py-2 pr-4 text-right font-normal">Entry</th>
                  <th className="py-2 pr-4 text-right font-normal">Current</th>
                  <th className="py-2 pr-4 text-right font-normal">P&amp;L</th>
                  <th className="py-2 pr-4 text-right font-normal">Amount</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 text-right font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((position) => (
                  <OpenPositionRow key={position.id} position={position} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Closed Positions</h2>
        {closedPositions.length === 0 ? (
          <p className="text-sm text-ink/50">No closed positions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse font-mono text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                  <th className="py-2 pr-4 font-normal">Token</th>
                  <th className="py-2 pr-4 text-right font-normal">Entry</th>
                  <th className="py-2 pr-4 text-right font-normal">Exit</th>
                  <th className="py-2 pr-4 text-right font-normal">P&amp;L</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 text-right font-normal">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((position) => {
                  const pnlPercent = ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100;
                  return (
                    <tr key={position.id} className="border-b border-ink/5">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-ink">{position.symbol}</div>
                        <div className="text-xs text-ink/40">{position.name}</div>
                      </td>
                      <td className="py-3 pr-4 text-right">{formatUsd(position.entryPrice)}</td>
                      <td className="py-3 pr-4 text-right">{formatUsd(position.exitPrice)}</td>
                      <td className="py-3 pr-4 text-right">
                        <span className={pnlPercent >= 0 ? "text-signal-green" : "text-signal-red"}>
                          {pnlPercent >= 0 ? "+" : ""}
                          {pnlPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right text-ink/50">
                        {new Date(position.openedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-right text-ink/50">
                        {new Date(position.closedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all pass, no regressions.

- [ ] **Step 6: Build verification**

```bash
npm run build
```

Expected: succeeds with no errors. Confirm the route table includes `ƒ /positions`.

- [ ] **Step 7: Live end-to-end verification**

Same curl + cookie-jar adaptation used in the last two plans (no browser-automation tooling in this project):

```bash
npm run dev
```

In another terminal:

1. Sign up a fresh test user via curl with a cookie jar to get a valid session.
2. `curl -s -b cookies.txt http://localhost:3000/positions` — confirm 200, contains "No open positions yet" and "No closed positions yet" (a fresh user has none).
3. `curl -s -b cookies.txt -X POST http://localhost:3000/api/positions -H 'Content-Type: application/json' -d '{"mintAddress":"<a real mint address from your local tokens table>","entryPrice":0.001,"amount":1000}'` — confirm 201. If your local DB has no tokens at all, this step will 400 (no DexScreener pair found) — query `select mint_address from tokens limit 1;` against `DATABASE_URL` first to find a real one, or accept the 400 as expected behavior for a nonexistent mint and verify the error path instead.
4. `curl -s -b cookies.txt http://localhost:3000/positions` — confirm the newly logged position now appears in the Open Positions section with the right entry price.
5. Using the position `id` returned from step 3 (`select id from positions where user_id = ... order by opened_at desc limit 1;` against `DATABASE_URL` if needed), `curl -s -b cookies.txt -X DELETE http://localhost:3000/api/positions/<id> -H 'Content-Type: application/json' -d '{"exitPrice":0.002}'` — confirm 200 (or a 400 with a clear DexScreener-lookup error if the mint address you used isn't real — either is acceptable evidence the validation path works, but note which one you actually observed).
6. `curl -s -b cookies.txt http://localhost:3000/positions` — confirm the position moved from Open to Closed with the right exit price and computed P&L.
7. `curl -s -i http://localhost:3000/positions` **without** the cookie jar — confirm a redirect to `/login`.
8. Stop the dev server when done.

Report the actual HTTP statuses and response content you observed for each step.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/layout.tsx" src/components/LogPositionForm.tsx src/components/OpenPositionRow.tsx "src/app/(app)/positions"
git commit -m "feat: add Watchlist page with log/close position flows"
```

---

## Self-Review Notes

- **Spec coverage:** log position, open positions with live P&L (including the `—` no-snapshot case), close with a real exit price, closed positions with realized P&L, nav link, and the read/write data-scoping split are all covered. Out-of-scope items (editing/deleting a logged position, partial closes, position price-history charting, a Coin Detail CTA) are genuinely absent from this plan's tasks.
- **`ClosedPositionSummary.exitPrice` non-null invariant:** this plan's `closePosition` always sets `exit_price` atomically with `closed_at`, so every row `getClosedPositionsForUser` returns has a real exit price going forward. The one theoretical gap: if this local dev database already has a position closed by the *old* one-argument `closePosition` (from Plan 3b, before this plan), it would have `closed_at` set but `exit_price` null, and `Number(null)` would render as `NaN%` in the Closed Positions table rather than crashing. This is a real but low-risk gap specific to pre-existing local dev data (no production users exist yet) — not worth a defensive `number | null` type and an extra UI state for what's currently a one-time, easily-reset local-database condition. If this surfaces during live verification, the fix is a one-line local `update positions set exit_price = entry_price, exit_market_cap = entry_market_cap where closed_at is not null and exit_price is null;` cleanup, not a code change.
- **Data-scoping is the one new security-relevant surface in this plan:** everything before this plan (discovery feed, Coin Detail) reads public market data visible to any authenticated user. `getOpenPositionsForUser`/`getClosedPositionsForUser` are the first reads scoped to `user_id`, and Task 2's tests explicitly assert a second user's positions never leak into the first user's results — this is the one property in this plan worth extra scrutiny in review.
- **Type consistency:** `OpenPositionWithPrice` and `ClosedPositionSummary` (Task 1) are consumed as-is by `OpenPositionRowData` (Task 3, structurally compatible, not re-declared with different field names) and the page's inline closed-position rendering — no redefinition drift.
