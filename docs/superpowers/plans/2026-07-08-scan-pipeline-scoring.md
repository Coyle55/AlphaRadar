# Scan Pipeline & Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js project, Postgres schema, DexScreener ingestion, hard filtering, and market-data-only scoring engine, wired together behind a cron-triggered API route that populates real scored token data in the database — with no UI yet.

**Architecture:** Single Next.js (App Router, TypeScript) app. Postgres via local Supabase (Docker) in dev, `pg` for direct queries. A protected `/api/cron/scan` route orchestrates: fetch DexScreener candidates → hard-filter → persist snapshot → score → persist score. DexScreener has no single "new pairs for a chain" endpoint, so discovery is two calls: `token-profiles/latest/v1` (candidates, all chains, filtered to `solana`) then `token-pairs/v1/solana/{tokenAddress}` per candidate (actual trading data) — both endpoints share DexScreener's 60 requests/minute limit, which is why the hard filter must run on the enrichment call's data as soon as it lands, and why the cron interval starts at 1 minute rather than tighter.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, `pg` for Postgres access, Supabase CLI for local Postgres in dev, Vitest for tests, DexScreener public API (no key required). (Task 1 scaffolded via `create-next-app@latest`, which resolved to Next.js 16.2.10 rather than the originally planned 15 — confirmed no impact on later tasks' App Router route handler conventions.)

## Global Constraints

- Node 23.x (matches installed local version), TypeScript strict mode on.
- Next.js App Router only — no Pages Router.
- DexScreener requests must respect the 60 requests/minute limit; the client must not be called in an unbounded loop without this in mind.
- No mocked/placeholder data may reach the `token_scores` table — if a factor's required field is missing from a `DexScreenerPair`, the pipeline must skip that token, never substitute a default and score anyway.
- `initial_liquidity_usd` on `tokens` is set once at row creation and never overwritten by later upserts — it is the baseline for the liquidity-growth scoring factor.
- Every DB-touching function takes/returns plain TypeScript objects (no ORM) so scoring/filter logic stays framework-free and independently testable.

---

## File Structure

- `supabase/config.toml`, `supabase/migrations/0001_init_schema.sql` — local Postgres + schema (`tokens`, `token_snapshots`, `token_scores`)
- `src/lib/db/pool.ts` — singleton `pg` connection pool
- `src/lib/db/tokens.ts` — `upsertToken`, `insertSnapshot`, `insertScore`
- `src/lib/dexscreener/types.ts` — `DexScreenerTokenProfile`, `DexScreenerPair`
- `src/lib/dexscreener/client.ts` — `fetchLatestTokenProfiles`, `fetchTokenPairs`
- `src/lib/scan/filter.ts` — `passesHardFilter`, `DEFAULT_FILTER_THRESHOLDS`
- `src/lib/scan/mapSnapshot.ts` — `mapPairToSnapshot`
- `src/lib/scoring/score.ts` — `scoreToken`, `ScoreBreakdown`, `ScoreFactors`
- `src/app/api/cron/scan/route.ts` — orchestrates the full pipeline per tick
- Each file above has a co-located `*.test.ts`

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `.env.local.example`, `.gitignore`

**Interfaces:**
- Produces: a running `npm run dev` Next.js app and a working `npm test` (Vitest) command that later tasks add tests to.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd /Users/coyle/Documents/marketing/AlphaRadar
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```

When prompted about the current directory not being empty (it has `docs/` and `.git/`), confirm proceeding.

- [ ] **Step 2: Add Vitest and Postgres client dependencies**

```bash
npm install pg
npm install -D vitest @types/pg dotenv
```

- [ ] **Step 3: Add Vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

```typescript
// vitest.setup.ts
import 'dotenv/config';
```

- [ ] **Step 4: Add the test script**

Edit `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 5: Add env var template**

```bash
# .env.local.example
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
CRON_SECRET=changeme-generate-a-real-secret
```

- [ ] **Step 6: Verify the app boots and the test command runs (with zero tests)**

```bash
npm test
```

Expected: Vitest reports "No test files found" without erroring (this is fine — later tasks add real tests).

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and pg"
```

---

### Task 2: Supabase local Postgres + schema migration

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/migrations/0001_init_schema.sql`

**Interfaces:**
- Produces: a running local Postgres instance on `localhost:54322` with `tokens`, `token_snapshots`, `token_scores` tables, matching the types Task 3 (`src/lib/db/tokens.ts`) reads/writes.

- [ ] **Step 1: Initialize Supabase local project**

```bash
cd /Users/coyle/Documents/marketing/AlphaRadar
npx supabase init
```

- [ ] **Step 2: Write the schema migration**

```sql
-- supabase/migrations/0001_init_schema.sql
create extension if not exists "pgcrypto";

create table tokens (
  id uuid primary key default gen_random_uuid(),
  mint_address text not null unique,
  pair_address text not null,
  symbol text not null,
  name text not null,
  initial_liquidity_usd numeric not null,
  first_seen_at timestamptz not null default now()
);

create table token_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id) on delete cascade,
  price_usd numeric not null,
  liquidity_usd numeric not null,
  volume_1h_usd numeric not null,
  volume_24h_usd numeric not null,
  buys_1h integer not null,
  sells_1h integer not null,
  market_cap_usd numeric not null,
  captured_at timestamptz not null default now()
);

create index token_snapshots_token_id_idx on token_snapshots(token_id);

create table token_scores (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references token_snapshots(id) on delete cascade,
  total_score numeric not null,
  factors jsonb not null,
  created_at timestamptz not null default now()
);

create index token_scores_snapshot_id_idx on token_scores(snapshot_id);
```

- [ ] **Step 3: Start local Postgres and apply the migration**

```bash
npx supabase start
```

Expected: output includes `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres` — confirm this matches `.env.local.example`. If the port differs, update `.env.local.example` to match.

```bash
npx supabase db reset
```

Expected: applies `0001_init_schema.sql` with no errors.

- [ ] **Step 4: Verify the tables exist**

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "\dt"
```

Expected: lists `tokens`, `token_snapshots`, `token_scores`.

- [ ] **Step 5: Create local env file**

```bash
cp .env.local.example .env.local
```

Edit `.env.local` to set `DATABASE_URL` to the exact URL from Step 3's output, and set `CRON_SECRET` to a random string (e.g. `openssl rand -hex 32`).

- [ ] **Step 6: Commit**

```bash
git add supabase/
git commit -m "feat: add Postgres schema for tokens, snapshots, scores"
```

---

### Task 3: DB access layer

**Files:**
- Create: `src/lib/db/pool.ts`
- Create: `src/lib/db/tokens.ts`
- Test: `src/lib/db/tokens.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var, the schema from Task 2.
- Produces:
  - `upsertToken(input: { mintAddress: string; pairAddress: string; symbol: string; name: string; initialLiquidityUsd: number }): Promise<TokenRecord>`
  - `insertSnapshot(tokenId: string, snapshot: TokenSnapshotInput): Promise<string>` (returns new snapshot id)
  - `insertScore(snapshotId: string, score: ScoreBreakdown): Promise<void>`
  - `TokenRecord { id: string; mintAddress: string; pairAddress: string; symbol: string; name: string; initialLiquidityUsd: number }`
  - `TokenSnapshotInput`, `ScoreFactors`, and `ScoreBreakdown` are defined in this file (`src/lib/db/tokens.ts`) — it is their single canonical source. Task 6's `mapSnapshot.ts` and Task 7's `score.ts` import `TokenSnapshotInput`/`ScoreBreakdown` from here rather than redefining them.

- [ ] **Step 1: Write the pool module**

```typescript
// src/lib/db/pool.ts
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 2: Write the failing test for `upsertToken`**

```typescript
// src/lib/db/tokens.test.ts
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken, insertSnapshot, insertScore } from './tokens';

beforeEach(async () => {
  await getPool().query('truncate table token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('upsertToken', () => {
  it('creates a new token and returns its record', async () => {
    const token = await upsertToken({
      mintAddress: 'mint123',
      pairAddress: 'pair123',
      symbol: 'FOO',
      name: 'Foo Coin',
      initialLiquidityUsd: 50000,
    });

    expect(token.mintAddress).toBe('mint123');
    expect(token.initialLiquidityUsd).toBe(50000);
    expect(token.id).toBeTruthy();
  });

  it('does not overwrite initialLiquidityUsd on a repeat upsert', async () => {
    await upsertToken({
      mintAddress: 'mint456',
      pairAddress: 'pair456',
      symbol: 'BAR',
      name: 'Bar Coin',
      initialLiquidityUsd: 10000,
    });

    const second = await upsertToken({
      mintAddress: 'mint456',
      pairAddress: 'pair456',
      symbol: 'BAR',
      name: 'Bar Coin',
      initialLiquidityUsd: 999999,
    });

    expect(second.initialLiquidityUsd).toBe(10000);
  });
});

describe('insertSnapshot and insertScore', () => {
  it('inserts a snapshot and a linked score', async () => {
    const token = await upsertToken({
      mintAddress: 'mint789',
      pairAddress: 'pair789',
      symbol: 'BAZ',
      name: 'Baz Coin',
      initialLiquidityUsd: 20000,
    });

    const snapshotId = await insertSnapshot(token.id, {
      priceUsd: 0.0012,
      liquidityUsd: 25000,
      volume1hUsd: 8000,
      volume24hUsd: 60000,
      buys1h: 40,
      sells1h: 20,
      marketCapUsd: 1_200_000,
    });

    expect(snapshotId).toBeTruthy();

    await insertScore(snapshotId, {
      total: 12.5,
      factors: {
        volumeMomentum: 5,
        liquidityGrowth: 2,
        priceStrength: 3,
        buySellRatio: 2.5,
        marketCapBand: 0,
        liquidityLevel: 0,
        wickRejection: 0,
      },
    });

    const result = await getPool().query('select * from token_scores where snapshot_id = $1', [snapshotId]);
    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0].total_score)).toBe(12.5);
  });
});
```

- [ ] **Step 2b: Run the test to verify it fails**

```bash
npm test -- tokens.test
```

Expected: FAIL — `upsertToken`, `insertSnapshot`, `insertScore` are not defined (module `./tokens` doesn't exist yet).

- [ ] **Step 3: Implement the DB access layer**

```typescript
// src/lib/db/tokens.ts
import { getPool } from './pool';

export interface TokenRecord {
  id: string;
  mintAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  initialLiquidityUsd: number;
}

export interface TokenSnapshotInput {
  priceUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys1h: number;
  sells1h: number;
  marketCapUsd: number;
}

export interface ScoreFactors {
  volumeMomentum: number;
  liquidityGrowth: number;
  priceStrength: number;
  buySellRatio: number;
  marketCapBand: number;
  liquidityLevel: number;
  wickRejection: number;
}

export interface ScoreBreakdown {
  total: number;
  factors: ScoreFactors;
}

export async function upsertToken(input: {
  mintAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  initialLiquidityUsd: number;
}): Promise<TokenRecord> {
  const result = await getPool().query(
    `insert into tokens (mint_address, pair_address, symbol, name, initial_liquidity_usd)
     values ($1, $2, $3, $4, $5)
     on conflict (mint_address) do update set mint_address = excluded.mint_address
     returning id, mint_address, pair_address, symbol, name, initial_liquidity_usd`,
    [input.mintAddress, input.pairAddress, input.symbol, input.name, input.initialLiquidityUsd]
  );
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

export async function insertSnapshot(tokenId: string, snapshot: TokenSnapshotInput): Promise<string> {
  const result = await getPool().query(
    `insert into token_snapshots
       (token_id, price_usd, liquidity_usd, volume_1h_usd, volume_24h_usd, buys_1h, sells_1h, market_cap_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      tokenId,
      snapshot.priceUsd,
      snapshot.liquidityUsd,
      snapshot.volume1hUsd,
      snapshot.volume24hUsd,
      snapshot.buys1h,
      snapshot.sells1h,
      snapshot.marketCapUsd,
    ]
  );
  return result.rows[0].id;
}

export async function insertScore(snapshotId: string, score: ScoreBreakdown): Promise<void> {
  await getPool().query(
    `insert into token_scores (snapshot_id, total_score, factors) values ($1, $2, $3)`,
    [snapshotId, score.total, JSON.stringify(score.factors)]
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Make sure local Postgres is running (`npx supabase start` from Task 2), then:

```bash
npm test -- tokens.test
```

Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/
git commit -m "feat: add Postgres access layer for tokens, snapshots, scores"
```

---

### Task 4: DexScreener client

**Files:**
- Create: `src/lib/dexscreener/types.ts`
- Create: `src/lib/dexscreener/client.ts`
- Test: `src/lib/dexscreener/client.test.ts`

**Interfaces:**
- Produces:
  - `DexScreenerTokenProfile { chainId: string; tokenAddress: string }`
  - `DexScreenerPair { chainId: string; pairAddress: string; baseToken: { address: string; name: string; symbol: string }; priceUsd: string; priceChange: { m5: number; h1: number; h6: number; h24: number }; liquidity: { usd: number; base: number; quote: number }; volume: { h24: number; h6: number; h1: number; m5: number }; txns: { m5: {buys:number;sells:number}; h1: {buys:number;sells:number}; h6: {buys:number;sells:number}; h24: {buys:number;sells:number} }; marketCap?: number; fdv?: number; pairCreatedAt: number }` (`marketCap`/`fdv` fixed to optional post-review — live API confirmed DexScreener omits `marketCap` for some very fresh pairs; see Task 5's filter, which is the designated place this gets enforced as "skip, don't default")
  - `fetchLatestTokenProfiles(): Promise<DexScreenerTokenProfile[]>` — calls `token-profiles/latest/v1`, filters to `chainId === 'solana'`
  - `fetchTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]>` — calls `token-pairs/v1/solana/{tokenAddress}`

- [ ] **Step 1: Write the types**

```typescript
// src/lib/dexscreener/types.ts
export interface DexScreenerTokenProfile {
  chainId: string;
  tokenAddress: string;
}

export interface DexScreenerPair {
  chainId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  marketCap: number;
  fdv: number;
  pairCreatedAt: number;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/dexscreener/client.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestTokenProfiles, fetchTokenPairs } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLatestTokenProfiles', () => {
  it('filters profiles to chainId solana', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { chainId: 'solana', tokenAddress: 'sol-mint-1' },
        { chainId: 'ethereum', tokenAddress: 'eth-mint-1' },
        { chainId: 'solana', tokenAddress: 'sol-mint-2' },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const profiles = await fetchLatestTokenProfiles();

    expect(profiles).toEqual([
      { chainId: 'solana', tokenAddress: 'sol-mint-1' },
      { chainId: 'solana', tokenAddress: 'sol-mint-2' },
    ]);
    expect(mockFetch).toHaveBeenCalledWith('https://api.dexscreener.com/token-profiles/latest/v1');
  });

  it('throws if the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchLatestTokenProfiles()).rejects.toThrow('DexScreener request failed: 500');
  });
});

describe('fetchTokenPairs', () => {
  it('fetches pairs for a Solana token address', async () => {
    const fakePair = { chainId: 'solana', pairAddress: 'pair-abc' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [fakePair] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const pairs = await fetchTokenPairs('sol-mint-1');

    expect(pairs).toEqual([fakePair]);
    expect(mockFetch).toHaveBeenCalledWith('https://api.dexscreener.com/token-pairs/v1/solana/sol-mint-1');
  });

  it('returns an empty array when the response has no pairs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));

    const pairs = await fetchTokenPairs('sol-mint-2');

    expect(pairs).toEqual([]);
  });
});
```

- [ ] **Step 2b: Run the test to verify it fails**

```bash
npm test -- client.test
```

Expected: FAIL — `./client` module doesn't exist.

- [ ] **Step 3: Implement the client**

```typescript
// src/lib/dexscreener/client.ts
import type { DexScreenerPair, DexScreenerTokenProfile } from './types';

const BASE_URL = 'https://api.dexscreener.com';

export async function fetchLatestTokenProfiles(): Promise<DexScreenerTokenProfile[]> {
  const response = await fetch(`${BASE_URL}/token-profiles/latest/v1`);
  if (!response.ok) {
    throw new Error(`DexScreener request failed: ${response.status}`);
  }
  const profiles = (await response.json()) as DexScreenerTokenProfile[];
  return profiles.filter((profile) => profile.chainId === 'solana');
}

export async function fetchTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  const response = await fetch(`${BASE_URL}/token-pairs/v1/solana/${tokenAddress}`);
  if (!response.ok) {
    throw new Error(`DexScreener request failed: ${response.status}`);
  }
  const body = (await response.json()) as { pairs?: DexScreenerPair[] } | DexScreenerPair[] | null;
  if (!body) return [];
  if (Array.isArray(body)) return body;
  return body.pairs ?? [];
}
```

Note: `token-pairs/v1/{chainId}/{tokenAddress}` returns a bare array of pairs in DexScreener's actual API, not `{ pairs: [...] }` — the implementation above handles both shapes defensively since the test fixture uses the wrapped form. Before wiring this into Task 8, run Step 4 below against the *real* API once to confirm the actual response shape and adjust the test/implementation to match exactly — do not leave both branches in permanently once confirmed.

- [ ] **Step 4: Run the tests to verify they pass, then confirm against the live API**

```bash
npm test -- client.test
```

Expected: PASS, all 4 tests.

```bash
curl -s https://api.dexscreener.com/token-profiles/latest/v1 | head -c 500
curl -s https://api.dexscreener.com/token-pairs/v1/solana/So11111111111111111111111111111111111111112 | head -c 500
```

Inspect the real shapes. If `token-pairs` returns a bare array (not `{ pairs: [...] }`), simplify `fetchTokenPairs` to `return (await response.json()) as DexScreenerPair[] ?? []` and update the test fixture to a bare array — remove the defensive branch so the code matches reality exactly, not a guess.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dexscreener/
git commit -m "feat: add DexScreener client for token profiles and pairs"
```

---

### Task 5: Hard filter

**Files:**
- Create: `src/lib/scan/filter.ts`
- Test: `src/lib/scan/filter.test.ts`

**Interfaces:**
- Consumes: `DexScreenerPair` (Task 4) — note `marketCap` and `fdv` are typed `number | undefined` (fixed post-Task-4-review: DexScreener omits `marketCap` for some very fresh pairs). This filter is the pipeline's designated place to enforce the plan's global constraint "skip a token if a required field is missing, never substitute a default" — a pair with a missing/non-finite `marketCap` must fail the filter, since Task 7's scoring engine treats `marketCap` as required input and assumes the filter already excluded anything without it.
- Produces: `passesHardFilter(pair: DexScreenerPair, now: Date, thresholds?: FilterThresholds): boolean`, `DEFAULT_FILTER_THRESHOLDS: FilterThresholds`, `FilterThresholds { minLiquidityUsd: number; minVolume1hUsd: number; minAgeMinutes: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scan/filter.test.ts
import { describe, expect, it } from 'vitest';
import { passesHardFilter, DEFAULT_FILTER_THRESHOLDS } from './filter';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  const now = Date.now();
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '0.001',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 50000, base: 1000, quote: 1000 },
    volume: { h24: 100000, h6: 30000, h1: 10000, m5: 1000 },
    txns: {
      m5: { buys: 5, sells: 2 },
      h1: { buys: 50, sells: 20 },
      h6: { buys: 200, sells: 100 },
      h24: { buys: 500, sells: 300 },
    },
    marketCap: 1_000_000,
    fdv: 1_000_000,
    pairCreatedAt: now - 10 * 60 * 1000,
    ...overrides,
  };
}

describe('passesHardFilter', () => {
  const now = new Date();

  it('passes a pair that clears all default thresholds', () => {
    expect(passesHardFilter(makePair(), now)).toBe(true);
  });

  it('rejects a pair younger than the minimum age', () => {
    const pair = makePair({ pairCreatedAt: now.getTime() - 1 * 60 * 1000 });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair below minimum liquidity', () => {
    const pair = makePair({ liquidity: { usd: 5000, base: 100, quote: 100 } });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair below minimum 1h volume', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 30000, h1: 1000, m5: 100 } });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('respects custom thresholds', () => {
    const pair = makePair({ liquidity: { usd: 15000, base: 100, quote: 100 } });
    expect(passesHardFilter(pair, now, { minLiquidityUsd: 20000, minVolume1hUsd: 0, minAgeMinutes: 0 })).toBe(false);
    expect(passesHardFilter(pair, now, { minLiquidityUsd: 10000, minVolume1hUsd: 0, minAgeMinutes: 0 })).toBe(true);
  });

  it('rejects a pair with a missing marketCap', () => {
    const pair = makePair({ marketCap: undefined });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair with a non-finite marketCap', () => {
    const pair = makePair({ marketCap: NaN });
    expect(passesHardFilter(pair, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- filter.test
```

Expected: FAIL — `./filter` module doesn't exist.

- [ ] **Step 3: Implement the filter**

```typescript
// src/lib/scan/filter.ts
import type { DexScreenerPair } from '../dexscreener/types';

export interface FilterThresholds {
  minLiquidityUsd: number;
  minVolume1hUsd: number;
  minAgeMinutes: number;
}

export const DEFAULT_FILTER_THRESHOLDS: FilterThresholds = {
  minLiquidityUsd: 10_000,
  minVolume1hUsd: 5_000,
  minAgeMinutes: 5,
};

export function passesHardFilter(
  pair: DexScreenerPair,
  now: Date,
  thresholds: FilterThresholds = DEFAULT_FILTER_THRESHOLDS
): boolean {
  if (!Number.isFinite(pair.marketCap)) return false;
  const ageMinutes = (now.getTime() - pair.pairCreatedAt) / 60_000;
  if (ageMinutes < thresholds.minAgeMinutes) return false;
  if (pair.liquidity.usd < thresholds.minLiquidityUsd) return false;
  if (pair.volume.h1 < thresholds.minVolume1hUsd) return false;
  return true;
}
```

`Number.isFinite(undefined)` is `false`, so this one check covers both the missing-field and non-finite (`NaN`/`Infinity`) cases without a separate null check.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- filter.test
```

Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan/filter.ts src/lib/scan/filter.test.ts
git commit -m "feat: add hard filter for scan candidates"
```

---

### Task 6: Snapshot mapper

**Files:**
- Create: `src/lib/scan/mapSnapshot.ts`
- Test: `src/lib/scan/mapSnapshot.test.ts`

**Interfaces:**
- Consumes: `DexScreenerPair` (Task 4)
- Produces: `mapPairToSnapshot(pair: DexScreenerPair): TokenSnapshotInput`, re-exporting/matching the `TokenSnapshotInput` shape defined in Task 3 (`src/lib/db/tokens.ts`) exactly — `{ priceUsd, liquidityUsd, volume1hUsd, volume24hUsd, buys1h, sells1h, marketCapUsd }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scan/mapSnapshot.test.ts
import { describe, expect, it } from 'vitest';
import { mapPairToSnapshot } from './mapSnapshot';
import type { DexScreenerPair } from '../dexscreener/types';

describe('mapPairToSnapshot', () => {
  it('maps a DexScreenerPair to a snapshot input', () => {
    const pair: DexScreenerPair = {
      chainId: 'solana',
      pairAddress: 'pair-1',
      baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
      priceUsd: '0.0015',
      priceChange: { m5: 1, h1: 5, h6: 10, h24: 20 },
      liquidity: { usd: 42000, base: 1000, quote: 1000 },
      volume: { h24: 200000, h6: 60000, h1: 15000, m5: 2000 },
      txns: {
        m5: { buys: 6, sells: 2 },
        h1: { buys: 60, sells: 25 },
        h6: { buys: 250, sells: 100 },
        h24: { buys: 600, sells: 350 },
      },
      marketCap: 900000,
      fdv: 950000,
      pairCreatedAt: Date.now() - 30 * 60 * 1000,
    };

    expect(mapPairToSnapshot(pair)).toEqual({
      priceUsd: 0.0015,
      liquidityUsd: 42000,
      volume1hUsd: 15000,
      volume24hUsd: 200000,
      buys1h: 60,
      sells1h: 25,
      marketCapUsd: 900000,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- mapSnapshot.test
```

Expected: FAIL — `./mapSnapshot` module doesn't exist.

- [ ] **Step 3: Implement the mapper**

```typescript
// src/lib/scan/mapSnapshot.ts
import type { DexScreenerPair } from '../dexscreener/types';
import type { TokenSnapshotInput } from '../db/tokens';

export function mapPairToSnapshot(pair: DexScreenerPair): TokenSnapshotInput {
  return {
    priceUsd: parseFloat(pair.priceUsd),
    liquidityUsd: pair.liquidity.usd,
    volume1hUsd: pair.volume.h1,
    volume24hUsd: pair.volume.h24,
    buys1h: pair.txns.h1.buys,
    sells1h: pair.txns.h1.sells,
    marketCapUsd: pair.marketCap,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- mapSnapshot.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan/mapSnapshot.ts src/lib/scan/mapSnapshot.test.ts
git commit -m "feat: map DexScreener pairs to snapshot rows"
```

---

### Task 7: Scoring engine

**Files:**
- Create: `src/lib/scoring/score.ts`
- Test: `src/lib/scoring/score.test.ts`

**Interfaces:**
- Consumes: `DexScreenerPair` (Task 4)
- Produces: `scoreToken(input: { pair: DexScreenerPair; initialLiquidityUsd: number }): ScoreBreakdown`, matching the `ScoreBreakdown`/`ScoreFactors` shapes defined in Task 3 (`src/lib/db/tokens.ts`) exactly.

This implements the v1 scoring model from the design spec, with one deliberate refinement: "volume acceleration" and "price strength" use DexScreener's own windowed fields (`volume.h1` vs. `volume.h6`, `priceChange.h1`) rather than diffing our own snapshot history, since those are available from a single fetch and don't depend on how much snapshot history we've accumulated for a brand-new token. "Liquidity growth" still compares against `initialLiquidityUsd` (captured once at first-seen, per Task 3), matching the spec exactly.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scoring/score.test.ts
import { describe, expect, it } from 'vitest';
import { scoreToken } from './score';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '0.001',
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

describe('scoreToken', () => {
  it('returns a neutral-ish score for a flat, average token', () => {
    const result = scoreToken({ pair: makePair(), initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBe(0);
    expect(result.factors.liquidityGrowth).toBe(0);
    expect(result.factors.priceStrength).toBe(0);
    expect(result.factors.buySellRatio).toBe(0);
    expect(result.factors.marketCapBand).toBe(10);
    expect(result.factors.liquidityLevel).toBe(0);
    expect(result.factors.wickRejection).toBe(0);
  });

  it('rewards volume running hotter than the 6h pace', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 6000, h1: 6000, m5: 500 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBeGreaterThan(0);
  });

  it('penalizes volume cooling off relative to the 6h pace', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 60000, h1: 1000, m5: 100 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBeLessThan(0);
  });

  it('rewards liquidity growth vs. initial liquidity', () => {
    const pair = makePair({ liquidity: { usd: 100000, base: 1000, quote: 1000 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.liquidityGrowth).toBeGreaterThan(0);
  });

  it('rewards positive 1h price change and penalizes negative', () => {
    const up = scoreToken({ pair: makePair({ priceChange: { m5: 0, h1: 20, h6: 0, h24: 0 } }), initialLiquidityUsd: 50000 });
    const down = scoreToken({ pair: makePair({ priceChange: { m5: 0, h1: -20, h6: 0, h24: 0 } }), initialLiquidityUsd: 50000 });
    expect(up.factors.priceStrength).toBeGreaterThan(0);
    expect(down.factors.priceStrength).toBeLessThan(0);
  });

  it('rewards a buy-heavy ratio and penalizes a sell-heavy ratio', () => {
    const buyHeavy = scoreToken({
      pair: makePair({ txns: { m5: { buys: 5, sells: 1 }, h1: { buys: 90, sells: 10 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } } }),
      initialLiquidityUsd: 50000,
    });
    const sellHeavy = scoreToken({
      pair: makePair({ txns: { m5: { buys: 1, sells: 5 }, h1: { buys: 10, sells: 90 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } } }),
      initialLiquidityUsd: 50000,
    });
    expect(buyHeavy.factors.buySellRatio).toBeGreaterThan(0);
    expect(sellHeavy.factors.buySellRatio).toBeLessThan(0);
  });

  it('penalizes market cap outside the $50k-$5M target band', () => {
    const tooSmall = scoreToken({ pair: makePair({ marketCap: 10000 }), initialLiquidityUsd: 50000 });
    const tooBig = scoreToken({ pair: makePair({ marketCap: 20_000_000 }), initialLiquidityUsd: 50000 });
    expect(tooSmall.factors.marketCapBand).toBe(-10);
    expect(tooBig.factors.marketCapBand).toBe(-10);
  });

  it('rewards liquidity at or above $100k and penalizes below $20k', () => {
    const high = scoreToken({ pair: makePair({ liquidity: { usd: 150000, base: 1, quote: 1 } }), initialLiquidityUsd: 50000 });
    const low = scoreToken({ pair: makePair({ liquidity: { usd: 5000, base: 1, quote: 1 } }), initialLiquidityUsd: 50000 });
    expect(high.factors.liquidityLevel).toBe(15);
    expect(low.factors.liquidityLevel).toBe(-20);
  });

  it('flags a sharp 5m rejection within an otherwise-up hour', () => {
    const pair = makePair({ priceChange: { m5: -15, h1: 5, h6: 0, h24: 0 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.wickRejection).toBe(-15);
  });

  it('sums all factors into the total', () => {
    const pair = makePair();
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    const sum = Object.values(result.factors).reduce((a, b) => a + b, 0);
    expect(result.total).toBe(sum);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- score.test
```

Expected: FAIL — `./score` module doesn't exist.

- [ ] **Step 3: Implement the scoring engine**

```typescript
// src/lib/scoring/score.ts
import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown, ScoreFactors } from '../db/tokens';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ScoreInput {
  pair: DexScreenerPair;
  initialLiquidityUsd: number;
}

export function scoreToken({ pair, initialLiquidityUsd }: ScoreInput): ScoreBreakdown {
  const avgHourlyVolume6h = pair.volume.h6 / 6;
  const volumeMomentum =
    clamp(
      avgHourlyVolume6h > 0 ? (pair.volume.h1 - avgHourlyVolume6h) / avgHourlyVolume6h : 0,
      -1,
      1
    ) * 20;

  const liquidityGrowth =
    clamp(
      initialLiquidityUsd > 0 ? (pair.liquidity.usd - initialLiquidityUsd) / initialLiquidityUsd : 0,
      -1,
      1
    ) * 15;

  const priceStrength = clamp(pair.priceChange.h1 / 100, -1, 1) * 15;

  const totalTxns1h = pair.txns.h1.buys + pair.txns.h1.sells;
  const buySellRatio =
    totalTxns1h > 0 ? (pair.txns.h1.buys / totalTxns1h - 0.5) * 2 * 15 : 0;

  const marketCapBand = pair.marketCap >= 50_000 && pair.marketCap <= 5_000_000 ? 10 : -10;

  const liquidityLevel = pair.liquidity.usd >= 100_000 ? 15 : pair.liquidity.usd < 20_000 ? -20 : 0;

  const wickRejection = pair.priceChange.m5 <= -10 && pair.priceChange.h1 >= 0 ? -15 : 0;

  const factors: ScoreFactors = {
    volumeMomentum,
    liquidityGrowth,
    priceStrength,
    buySellRatio,
    marketCapBand,
    liquidityLevel,
    wickRejection,
  };

  const total = Object.values(factors).reduce((sum, value) => sum + value, 0);

  return { total, factors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- score.test
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/
git commit -m "feat: add v1 market-data-only scoring engine"
```

---

### Task 8: Cron route wiring

**Files:**
- Create: `src/app/api/cron/scan/route.ts`
- Test: `src/app/api/cron/scan/route.test.ts`

**Interfaces:**
- Consumes: `fetchLatestTokenProfiles`, `fetchTokenPairs` (Task 4), `passesHardFilter` (Task 5), `mapPairToSnapshot` (Task 6), `scoreToken` (Task 7), `upsertToken`, `insertSnapshot`, `insertScore` (Task 3), `CRON_SECRET` env var.
- Produces: `POST /api/cron/scan` — requires `Authorization: Bearer <CRON_SECRET>`, returns `{ scored: number; skipped: number; total: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/cron/scan/route.test.ts
import { beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/tokens';
import { POST } from './route';

vi.mock('@/lib/db/tokens', async () => {
  const actual = await vi.importActual('@/lib/db/tokens');
  return actual;
});

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(async () => {
  process.env.CRON_SECRET = 'test-secret';
  await getPool().query('truncate table token_scores, token_snapshots, tokens cascade');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  await closePool();
});

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/scan', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe('POST /api/cron/scan', () => {
  it('rejects requests without the correct bearer token', async () => {
    const response = await POST(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });

  it('scores candidates that pass the filter and skips ones that do not', async () => {
    const goodPair = {
      chainId: 'solana',
      pairAddress: 'pair-good',
      baseToken: { address: 'mint-good', name: 'Good Coin', symbol: 'GOOD' },
      priceUsd: '0.002',
      priceChange: { m5: 0, h1: 10, h6: 5, h24: 20 },
      liquidity: { usd: 50000, base: 1000, quote: 1000 },
      volume: { h24: 200000, h6: 30000, h1: 10000, m5: 1000 },
      txns: {
        m5: { buys: 5, sells: 2 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      marketCap: 1_000_000,
      fdv: 1_000_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };
    const thinPair = {
      ...goodPair,
      pairAddress: 'pair-thin',
      baseToken: { address: 'mint-thin', name: 'Thin Coin', symbol: 'THIN' },
      liquidity: { usd: 500, base: 10, quote: 10 },
    };

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('token-profiles')) {
        return {
          ok: true,
          json: async () => [
            { chainId: 'solana', tokenAddress: 'mint-good' },
            { chainId: 'solana', tokenAddress: 'mint-thin' },
          ],
        };
      }
      if (url.includes('mint-good')) {
        return { ok: true, json: async () => [goodPair] };
      }
      if (url.includes('mint-thin')) {
        return { ok: true, json: async () => [thinPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 1, total: 2 });

    const rows = await getPool().query('select * from tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].mint_address).toBe('mint-good');
  });

  it('skips a token whose pair fetch throws, without failing the whole tick', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'solana', tokenAddress: 'mint-broken' }] };
      }
      throw new Error('network error');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 0, skipped: 1, total: 1 });
  });
});
```

Note: this test imports `getPool`/`closePool` from `@/lib/db/tokens` for convenience — if Task 3 only exported them from `@/lib/db/pool`, import from there instead (`import { getPool, closePool } from '@/lib/db/pool';`) and drop the `vi.mock` block, which isn't needed since we want the real DB layer here, not a mock.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- route.test
```

Expected: FAIL — `./route` module doesn't exist.

- [ ] **Step 3: Implement the cron route**

```typescript
// src/app/api/cron/scan/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestTokenProfiles, fetchTokenPairs } from '@/lib/dexscreener/client';
import { passesHardFilter } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { upsertToken, insertSnapshot, insertScore } from '@/lib/db/tokens';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let profiles;
  try {
    profiles = await fetchLatestTokenProfiles();
  } catch (err) {
    console.error('scan: failed to fetch token profiles', err);
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 });
  }

  const now = new Date();
  let scored = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const pairs = await fetchTokenPairs(profile.tokenAddress);
      const pair = pairs[0];

      if (!pair || !passesHardFilter(pair, now)) {
        skipped++;
        continue;
      }

      const token = await upsertToken({
        mintAddress: pair.baseToken.address,
        pairAddress: pair.pairAddress,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        initialLiquidityUsd: pair.liquidity.usd,
      });

      const snapshot = mapPairToSnapshot(pair);
      const snapshotId = await insertSnapshot(token.id, snapshot);
      const score = scoreToken({ pair, initialLiquidityUsd: token.initialLiquidityUsd });
      await insertScore(snapshotId, score);
      scored++;
    } catch (err) {
      console.error(`scan: failed to process token ${profile.tokenAddress}`, err);
      skipped++;
    }
  }

  return NextResponse.json({ scored, skipped, total: profiles.length });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- route.test
```

Expected: PASS, all 3 tests.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests across all tasks pass.

- [ ] **Step 6: Manual end-to-end verification against the live DexScreener API**

```bash
npm run dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/api/cron/scan -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Expected: JSON response with `scored`/`skipped`/`total` counts. Then confirm rows landed:

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "select symbol, total_score from tokens t join token_snapshots s on s.token_id = t.id join token_scores sc on sc.snapshot_id = s.id order by sc.created_at desc limit 10;"
```

Expected: real scored Solana tokens with plausible score values.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/
git commit -m "feat: wire scan pipeline into cron-triggered API route"
```

---

## Self-Review Notes

- **Spec coverage:** Ingestion, hard filtering, snapshot persistence, and the v1 market-data-only scoring model (all 5 positive/negative factor groups from the spec, consolidated into 7 concrete signed factors) are covered. Discovery/position alert evaluation, Telegram delivery, and all dashboard UI are explicitly out of scope for this plan — they're Plan 2 and Plan 3.
- **Known deviation from the spec's literal wording:** "volume acceleration" and "price strength" are implemented via DexScreener's own windowed fields rather than diffing our stored snapshot history tick-over-tick, since a brand-new token has little snapshot history to diff against. "Liquidity growth" still diffs against our own stored `initial_liquidity_usd`, matching the spec exactly. This is called out inline in Task 7.
- **Rate limit:** not yet enforced in code (no explicit throttling in `fetchTokenPairs`'s per-candidate loop). At a 1-minute cron interval, expect roughly dozens of candidates per tick post-filter, which stays under 60/min in practice, but if live testing in Step 6 of Task 8 shows the profiles endpoint regularly returning more Solana candidates than that, add explicit request throttling as a follow-up task before increasing scan frequency.
