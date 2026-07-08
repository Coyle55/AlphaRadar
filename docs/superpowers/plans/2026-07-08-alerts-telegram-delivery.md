# Discovery Alerts & Telegram Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate the four discovery alert rules (Buy Watch, Volume Spike, Liquidity Danger, Trend Break) against every candidate the existing scan pipeline scores, persist any that fire, and deliver them to a single Telegram chat — extending Plan 1's `/api/cron/scan` route, no new scheduling infrastructure, no web UI.

**Architecture:** Adds an `alerts` table and three small library modules (alert rule evaluation, snapshot-history queries, a Telegram client) that the existing cron route calls immediately after scoring each candidate. Two of the four alert types need a token's history (a prior snapshot for liquidity-drop detection, a recorded local-high price for trend-break detection) — both come from `token_snapshots`, which Plan 1 already writes every tick.

**Tech Stack:** Same as Plan 1 — Next.js 16 (App Router) + TypeScript, `pg`, local Supabase Postgres, Vitest. New: Telegram Bot API (no SDK, plain `fetch`).

## Global Constraints

- Telegram delivery failures must never crash the scan tick or be conflated with scan/scoring failures — alert delivery has its own try/catch, separate from the `scored`/`skipped` counters.
- An alert's `payload` captures the actual score and pair data at trigger time and is never re-derived after the fact.
- Cooldown is 30 minutes per `(token_id, alert_type)` pair — the same alert type must not fire again for the same token within that window.
- The Buy Watch rule's market-cap check reuses `getEffectiveMarketCap` from Plan 1's `src/lib/scan/filter.ts` — do not reintroduce a separate marketCap-only check (Plan 1 already established that `marketCap` can be missing and `fdv` is the fallback).
- Every DB-touching function takes/returns plain TypeScript objects (no ORM), matching Plan 1's established pattern.
- TypeScript strict mode on; Next.js App Router only.

---

## File Structure

- `supabase/migrations/0002_alerts_table.sql` — new `alerts` table
- `src/lib/db/alerts.ts` — `AlertType`, `AlertPayload`, `NewAlertInput`, `AlertRecord`, `ALERT_COOLDOWN_MINUTES`, `wasRecentlyAlerted`, `insertAlert`, `markTelegramResult`
- `src/lib/scan/history.ts` — `PriorSnapshot`, `getPriorSnapshot`, `getLocalHighPrice`
- `src/lib/alerts/rules.ts` — `AlertEvaluationInput`, `evaluateDiscoveryAlerts`
- `src/lib/telegram/client.ts` — `sendTelegramMessage`
- `src/lib/alerts/format.ts` — `formatAlertMessage`
- `src/app/api/cron/scan/route.ts` — modified to call alert evaluation/delivery after scoring each candidate
- Each new file has a co-located `*.test.ts`; `route.test.ts` is extended with new cases

---

### Task 1: Telegram bot setup (manual)

**Files:** none created by code — this is manual setup plus updating `.env.local` / `.env.local.example`.

**Interfaces:**
- Produces: a real `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`, and documented placeholders in `.env.local.example`. Task 7's live end-to-end verification depends on these being real, working credentials.

- [ ] **Step 1: Create the bot**

In Telegram, message `@BotFather`, send `/newbot`, and follow the prompts (choose a name and a unique username ending in `bot`). BotFather replies with a token that looks like `123456789:AAH...`. Copy it.

- [ ] **Step 2: Start a chat with the bot and find the chat ID**

Search for the bot's username in Telegram and press Start (or send it any message). Then run:

```bash
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
```

Find `"chat":{"id":<NUMBER>,...}` in the response — that number is `TELEGRAM_CHAT_ID`. If the response is empty, send the bot another message and retry (Telegram only returns updates it hasn't delivered yet).

- [ ] **Step 3: Add the env vars**

Edit `.env.local`:

```bash
TELEGRAM_BOT_TOKEN=<your real token>
TELEGRAM_CHAT_ID=<your real chat id>
```

Edit `.env.local.example`, adding placeholder lines (do not put real credentials in this file — it's committed):

```bash
TELEGRAM_BOT_TOKEN=changeme-telegram-bot-token
TELEGRAM_CHAT_ID=changeme-telegram-chat-id
```

- [ ] **Step 4: Verify the bot can actually send a message**

```bash
curl -s -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
  -d "chat_id=<YOUR_CHAT_ID>" \
  -d "text=AlphaRadar setup check"
```

Expected: JSON response with `"ok":true`, and the message appears in your Telegram chat with the bot immediately.

- [ ] **Step 5: Commit the updated example file**

```bash
git add .env.local.example
git commit -m "chore: document Telegram env vars"
```

---

### Task 2: Alerts table migration

**Files:**
- Create: `supabase/migrations/0002_alerts_table.sql`

**Interfaces:**
- Produces: an `alerts` table in the same local Postgres instance from Plan 1, matching the types Task 3 (`src/lib/db/alerts.ts`) reads/writes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0002_alerts_table.sql
create table alerts (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id) on delete cascade,
  alert_type text not null,
  triggered_at timestamptz not null default now(),
  payload jsonb not null,
  telegram_sent boolean not null default false,
  telegram_error text
);

create index alerts_token_type_triggered_idx on alerts(token_id, alert_type, triggered_at desc);
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db reset
```

Expected: re-applies `0001_init_schema.sql` and `0002_alerts_table.sql` with no errors (this is the same local dev database from Plan 1 — resetting it is safe, it only holds scan data, not anything you need to preserve).

- [ ] **Step 3: Verify the table exists**

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "\d alerts"
```

Expected: lists all 7 columns (`id`, `token_id`, `alert_type`, `triggered_at`, `payload`, `telegram_sent`, `telegram_error`) and the index.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_alerts_table.sql
git commit -m "feat: add alerts table"
```

---

### Task 3: Alerts DB access layer

**Files:**
- Create: `src/lib/db/alerts.ts`
- Test: `src/lib/db/alerts.test.ts`

**Interfaces:**
- Consumes: `getPool`/`closePool` (`src/lib/db/pool.ts`, Plan 1), `upsertToken` (`src/lib/db/tokens.ts`, Plan 1, used only in tests to satisfy the `token_id` foreign key), `ScoreBreakdown` (`src/lib/db/tokens.ts`, Plan 1), `DexScreenerPair` (`src/lib/dexscreener/types.ts`, Plan 1).
- Produces:
  - `AlertType = 'buy_watch' | 'volume_spike' | 'liquidity_danger' | 'trend_break'` — this is the canonical source of this type; Task 5 (`rules.ts`) and Task 6 (`format.ts`) import it from here.
  - `ALERT_COOLDOWN_MINUTES = 30`
  - `AlertPayload { score: ScoreBreakdown; pair: DexScreenerPair }`
  - `NewAlertInput { tokenId: string; alertType: AlertType; payload: AlertPayload }`
  - `AlertRecord { id: string; tokenId: string; alertType: AlertType; triggeredAt: string; payload: AlertPayload; telegramSent: boolean; telegramError: string | null }`
  - `wasRecentlyAlerted(tokenId: string, alertType: AlertType, cooldownMinutes?: number): Promise<boolean>`
  - `insertAlert(input: NewAlertInput): Promise<AlertRecord>`
  - `markTelegramResult(alertId: string, sent: boolean, error: string | null): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/db/alerts.test.ts
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken } from './tokens';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';
import { wasRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from './alerts';

const fakeScore: ScoreBreakdown = {
  total: 10,
  factors: {
    volumeMomentum: 5,
    liquidityGrowth: 0,
    priceStrength: 0,
    buySellRatio: 0,
    marketCapBand: 5,
    liquidityLevel: 0,
    wickRejection: 0,
  },
};

const fakePair: DexScreenerPair = {
  chainId: 'solana',
  pairAddress: 'pair-alert-1',
  baseToken: { address: 'mint-alert-1', name: 'Alert Coin', symbol: 'ALRT' },
  priceUsd: '0.01',
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
  pairCreatedAt: Date.now() - 60 * 60 * 1000,
};

beforeEach(async () => {
  await getPool().query('truncate table alerts, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('insertAlert and wasRecentlyAlerted', () => {
  it('inserts an alert and finds it within the cooldown window', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-1',
      pairAddress: 'pair-alert-1',
      symbol: 'ALRT',
      name: 'Alert Coin',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });

    expect(alert.alertType).toBe('buy_watch');
    expect(alert.telegramSent).toBe(false);
    expect(alert.telegramError).toBeNull();

    const recent = await wasRecentlyAlerted(token.id, 'buy_watch', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(true);
  });

  it('does not report a cooldown hit for a different alert type on the same token', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-2',
      pairAddress: 'pair-alert-2',
      symbol: 'ALRT2',
      name: 'Alert Coin 2',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });

    const recent = await wasRecentlyAlerted(token.id, 'volume_spike', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(false);
  });

  it('does not report a cooldown hit once the cooldown window is 0 minutes', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-3',
      pairAddress: 'pair-alert-3',
      symbol: 'ALRT3',
      name: 'Alert Coin 3',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({ tokenId: token.id, alertType: 'trend_break', payload: { score: fakeScore, pair: fakePair } });

    const recent = await wasRecentlyAlerted(token.id, 'trend_break', 0);
    expect(recent).toBe(false);
  });
});

describe('markTelegramResult', () => {
  it('updates telegram_sent and telegram_error', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-4',
      pairAddress: 'pair-alert-4',
      symbol: 'ALRT4',
      name: 'Alert Coin 4',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'liquidity_danger',
      payload: { score: fakeScore, pair: fakePair },
    });
    await markTelegramResult(alert.id, false, 'Telegram sendMessage failed: 500 boom');

    const result = await getPool().query('select telegram_sent, telegram_error from alerts where id = $1', [alert.id]);
    expect(result.rows[0].telegram_sent).toBe(false);
    expect(result.rows[0].telegram_error).toBe('Telegram sendMessage failed: 500 boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- alerts.test
```

Expected: FAIL — `./alerts` module doesn't exist.

- [ ] **Step 3: Implement the alerts DB access layer**

```typescript
// src/lib/db/alerts.ts
import { getPool } from './pool';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';

export type AlertType = 'buy_watch' | 'volume_spike' | 'liquidity_danger' | 'trend_break';

export const ALERT_COOLDOWN_MINUTES = 30;

export interface AlertPayload {
  score: ScoreBreakdown;
  pair: DexScreenerPair;
}

export interface NewAlertInput {
  tokenId: string;
  alertType: AlertType;
  payload: AlertPayload;
}

export interface AlertRecord {
  id: string;
  tokenId: string;
  alertType: AlertType;
  triggeredAt: string;
  payload: AlertPayload;
  telegramSent: boolean;
  telegramError: string | null;
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

export async function insertAlert(input: NewAlertInput): Promise<AlertRecord> {
  const result = await getPool().query(
    `insert into alerts (token_id, alert_type, payload)
     values ($1, $2, $3)
     returning id, token_id, alert_type, triggered_at, payload, telegram_sent, telegram_error`,
    [input.tokenId, input.alertType, JSON.stringify(input.payload)]
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

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- alerts.test
```

Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/alerts.ts src/lib/db/alerts.test.ts
git commit -m "feat: add alerts DB access layer"
```

---

### Task 4: Snapshot history queries

**Files:**
- Create: `src/lib/scan/history.ts`
- Test: `src/lib/scan/history.test.ts`

**Interfaces:**
- Consumes: `getPool`/`closePool` (`src/lib/db/pool.ts`), `upsertToken`/`insertSnapshot` (`src/lib/db/tokens.ts`) — both Plan 1, used to set up test fixtures.
- Produces:
  - `PriorSnapshot { liquidityUsd: number; priceUsd: number; capturedAt: string }` — `captured_at` is a `timestamptz` column, and `pg` returns those as native `Date` objects, not strings (this bit Task 3's `triggeredAt` field the same way — call `.toISOString()` on it before assigning, don't pass the raw `Date` through).
  - `getPriorSnapshot(tokenId: string): Promise<PriorSnapshot | null>` — the second-most-recent snapshot for a token (i.e. the one before whatever was just inserted this tick), or `null` if fewer than two snapshots exist.
  - `getLocalHighPrice(tokenId: string): Promise<number | null>` — the maximum `price_usd` across all of a token's stored snapshots, or `null` if none exist.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scan/history.test.ts
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../db/pool';
import { upsertToken, insertSnapshot } from '../db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from './history';

beforeEach(async () => {
  await getPool().query('truncate table token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('getPriorSnapshot', () => {
  it('returns null when there is only one snapshot', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-1',
      pairAddress: 'pair-hist-1',
      symbol: 'HIST1',
      name: 'History Coin 1',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });

    const prior = await getPriorSnapshot(token.id);
    expect(prior).toBeNull();
  });

  it('returns the second-most-recent snapshot when at least two exist', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-2',
      pairAddress: 'pair-hist-2',
      symbol: 'HIST2',
      name: 'History Coin 2',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.02,
      liquidityUsd: 20000,
      volume1hUsd: 2000,
      volume24hUsd: 6000,
      buys1h: 20,
      sells1h: 10,
      marketCapUsd: 200000,
    });

    const prior = await getPriorSnapshot(token.id);
    expect(prior).not.toBeNull();
    expect(prior?.liquidityUsd).toBe(10000);
    expect(prior?.priceUsd).toBe(0.01);
  });
});

describe('getLocalHighPrice', () => {
  it('returns null when there are no snapshots', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-3',
      pairAddress: 'pair-hist-3',
      symbol: 'HIST3',
      name: 'History Coin 3',
      initialLiquidityUsd: 10000,
    });
    const high = await getLocalHighPrice(token.id);
    expect(high).toBeNull();
  });

  it('returns the maximum price_usd across all snapshots', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-4',
      pairAddress: 'pair-hist-4',
      symbol: 'HIST4',
      name: 'History Coin 4',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.05,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.03,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });

    const high = await getLocalHighPrice(token.id);
    expect(high).toBe(0.05);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- history.test
```

Expected: FAIL — `./history` module doesn't exist.

- [ ] **Step 3: Implement the history queries**

```typescript
// src/lib/scan/history.ts
import { getPool } from '../db/pool';

export interface PriorSnapshot {
  liquidityUsd: number;
  priceUsd: number;
  capturedAt: string;
}

export async function getPriorSnapshot(tokenId: string): Promise<PriorSnapshot | null> {
  const result = await getPool().query(
    `select liquidity_usd, price_usd, captured_at
     from token_snapshots
     where token_id = $1
     order by captured_at desc
     offset 1 limit 1`,
    [tokenId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    liquidityUsd: Number(row.liquidity_usd),
    priceUsd: Number(row.price_usd),
    capturedAt: row.captured_at.toISOString(),
  };
}

export async function getLocalHighPrice(tokenId: string): Promise<number | null> {
  const result = await getPool().query(`select max(price_usd) as max_price from token_snapshots where token_id = $1`, [
    tokenId,
  ]);
  const maxPrice = result.rows[0]?.max_price;
  return maxPrice === null || maxPrice === undefined ? null : Number(maxPrice);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- history.test
```

Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan/history.ts src/lib/scan/history.test.ts
git commit -m "feat: add snapshot history queries for alert evaluation"
```

---

### Task 5: Alert rule evaluation

**Files:**
- Create: `src/lib/alerts/rules.ts`
- Test: `src/lib/alerts/rules.test.ts`

**Interfaces:**
- Consumes: `DexScreenerPair` (`src/lib/dexscreener/types.ts`), `ScoreBreakdown` (`src/lib/db/tokens.ts`), `AlertType` (`src/lib/db/alerts.ts` — canonical source, Task 3), `PriorSnapshot` (`src/lib/scan/history.ts`, Task 4), `getEffectiveMarketCap` (`src/lib/scan/filter.ts`, Plan 1 — reused, not redefined).
- Produces: `AlertEvaluationInput { pair: DexScreenerPair; score: ScoreBreakdown; priorSnapshot: PriorSnapshot | null; localHighPrice: number | null }`, `evaluateDiscoveryAlerts(input: AlertEvaluationInput): AlertType[]` — pure function, no I/O, may return more than one type if multiple rules fire in the same evaluation.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/alerts/rules.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateDiscoveryAlerts } from './rules';
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

describe('evaluateDiscoveryAlerts', () => {
  it('returns no alerts for a flat, unremarkable token with no history', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore(),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toEqual([]);
  });

  it('fires buy_watch when all buy-watch conditions are met', () => {
    const pair = makePair({
      marketCap: 2_000_000,
      liquidity: { usd: 150000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).toContain('buy_watch');
  });

  it('does not fire buy_watch when market cap is above the threshold', () => {
    const pair = makePair({
      marketCap: 10_000_000,
      liquidity: { usd: 150000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).not.toContain('buy_watch');
  });

  it('fires volume_spike when volumeMomentum meets the threshold', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: 18 }),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('volume_spike');
  });

  it('does not fire volume_spike when volumeMomentum is below the threshold', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: 10 }),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).not.toContain('volume_spike');
  });

  it('fires liquidity_danger when liquidity dropped 20% or more since the prior snapshot', () => {
    const pair = makePair({ liquidity: { usd: 40000, base: 1, quote: 1 } });
    const fired = evaluateDiscoveryAlerts({
      pair,
      score: makeScore(),
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('liquidity_danger');
  });

  it('does not fire liquidity_danger with no prior snapshot', () => {
    const pair = makePair({ liquidity: { usd: 100, base: 1, quote: 1 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).not.toContain('liquidity_danger');
  });

  it('fires trend_break when price is down 10% or more from the local high and h1 change is negative', () => {
    const pair = makePair({ priceUsd: '0.89', priceChange: { m5: 0, h1: -5, h6: 0, h24: 0 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: 1.0 });
    expect(fired).toContain('trend_break');
  });

  it('does not fire trend_break when h1 change is positive despite the price drop from high', () => {
    const pair = makePair({ priceUsd: '0.89', priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: 1.0 });
    expect(fired).not.toContain('trend_break');
  });

  it('can fire multiple alert types in the same evaluation', () => {
    const pair = makePair({
      marketCap: 2_000_000,
      liquidity: { usd: 40000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({
      pair,
      score: makeScore({ volumeMomentum: 18 }),
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('buy_watch');
    expect(fired).toContain('volume_spike');
    expect(fired).toContain('liquidity_danger');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- rules.test
```

Expected: FAIL — `./rules` module doesn't exist.

- [ ] **Step 3: Implement the alert rules**

```typescript
// src/lib/alerts/rules.ts
import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';
import type { AlertType } from '../db/alerts';
import type { PriorSnapshot } from '../scan/history';
import { getEffectiveMarketCap } from '../scan/filter';

export interface AlertEvaluationInput {
  pair: DexScreenerPair;
  score: ScoreBreakdown;
  priorSnapshot: PriorSnapshot | null;
  localHighPrice: number | null;
}

const BUY_WATCH_MAX_MARKET_CAP = 5_000_000;
const BUY_WATCH_MIN_LIQUIDITY = 100_000;
const BUY_WATCH_MIN_VOLUME_1H = 250_000;
const VOLUME_SPIKE_THRESHOLD = 15;
const LIQUIDITY_DANGER_DROP_RATIO = 0.2;
const TREND_BREAK_DROP_RATIO = 0.1;

export function evaluateDiscoveryAlerts(input: AlertEvaluationInput): AlertType[] {
  const fired: AlertType[] = [];
  if (evaluatesBuyWatch(input.pair)) fired.push('buy_watch');
  if (evaluatesVolumeSpike(input.score)) fired.push('volume_spike');
  if (evaluatesLiquidityDanger(input.pair, input.priorSnapshot)) fired.push('liquidity_danger');
  if (evaluatesTrendBreak(input.pair, input.localHighPrice)) fired.push('trend_break');
  return fired;
}

function evaluatesBuyWatch(pair: DexScreenerPair): boolean {
  const marketCap = getEffectiveMarketCap(pair);
  if (marketCap === undefined) return false;
  return (
    marketCap < BUY_WATCH_MAX_MARKET_CAP &&
    pair.liquidity.usd >= BUY_WATCH_MIN_LIQUIDITY &&
    pair.volume.h1 >= BUY_WATCH_MIN_VOLUME_1H &&
    pair.priceChange.h1 > 0 &&
    pair.txns.h1.buys > pair.txns.h1.sells
  );
}

function evaluatesVolumeSpike(score: ScoreBreakdown): boolean {
  return score.factors.volumeMomentum >= VOLUME_SPIKE_THRESHOLD;
}

function evaluatesLiquidityDanger(pair: DexScreenerPair, prior: PriorSnapshot | null): boolean {
  if (!prior || prior.liquidityUsd <= 0) return false;
  const dropRatio = (prior.liquidityUsd - pair.liquidity.usd) / prior.liquidityUsd;
  return dropRatio >= LIQUIDITY_DANGER_DROP_RATIO;
}

function evaluatesTrendBreak(pair: DexScreenerPair, localHigh: number | null): boolean {
  if (!localHigh || localHigh <= 0) return false;
  const currentPrice = parseFloat(pair.priceUsd);
  const dropRatio = (localHigh - currentPrice) / localHigh;
  return dropRatio >= TREND_BREAK_DROP_RATIO && pair.priceChange.h1 < 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- rules.test
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/rules.ts src/lib/alerts/rules.test.ts
git commit -m "feat: add discovery alert rule evaluation"
```

---

### Task 6: Telegram client and alert message formatting

**Files:**
- Create: `src/lib/telegram/client.ts`
- Test: `src/lib/telegram/client.test.ts`
- Create: `src/lib/alerts/format.ts`
- Test: `src/lib/alerts/format.test.ts`

**Interfaces:**
- `sendTelegramMessage(text: string): Promise<void>` — reads `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` from `process.env`; throws if either is unset, or if the Telegram API responds non-ok.
- `formatAlertMessage(alertType: AlertType, pair: DexScreenerPair): string` — consumes `AlertType` (`src/lib/db/alerts.ts`) and `DexScreenerPair` (`src/lib/dexscreener/types.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/telegram/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from './client';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('sendTelegramMessage', () => {
  it('posts to the Telegram Bot API with the configured token and chat id', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTelegramMessage('hello world');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: 'test-chat-id', text: 'hello world', parse_mode: 'Markdown' }),
      })
    );
  });

  it('throws with response details when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' }));

    await expect(sendTelegramMessage('hello')).rejects.toThrow('Telegram sendMessage failed: 400 bad request');
  });

  it('throws if TELEGRAM_BOT_TOKEN is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(sendTelegramMessage('hello')).rejects.toThrow(
      'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured'
    );
  });

  it('throws if TELEGRAM_CHAT_ID is not configured', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    await expect(sendTelegramMessage('hello')).rejects.toThrow(
      'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured'
    );
  });
});
```

```typescript
// src/lib/alerts/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatAlertMessage } from './format';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-format-1',
    baseToken: { address: 'mint-format-1', name: 'Format Coin', symbol: 'FMT' },
    priceUsd: '0.0042',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 123456, base: 1000, quote: 1000 },
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

describe('formatAlertMessage', () => {
  it('includes the alert label, symbol, name, price, liquidity, and a dexscreener link', () => {
    const message = formatAlertMessage('buy_watch', makePair());
    expect(message).toContain('Buy Watch');
    expect(message).toContain('FMT');
    expect(message).toContain('Format Coin');
    expect(message).toContain('$0.0042');
    expect(message).toContain('123,456');
    expect(message).toContain('https://dexscreener.com/solana/pair-format-1');
  });

  it('uses the correct label for each alert type', () => {
    expect(formatAlertMessage('volume_spike', makePair())).toContain('Volume Spike');
    expect(formatAlertMessage('liquidity_danger', makePair())).toContain('Liquidity Danger');
    expect(formatAlertMessage('trend_break', makePair())).toContain('Trend Break');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- client.test
npm test -- format.test
```

Expected: both FAIL — modules don't exist. (Note: `client.test` will match both this new `src/lib/telegram/client.test.ts` and Plan 1's existing `src/lib/dexscreener/client.test.ts` — that's fine, Plan 1's should still pass; only the new one is expected to fail here.)

- [ ] **Step 3: Implement the Telegram client**

```typescript
// src/lib/telegram/client.ts
const TELEGRAM_API_BASE = 'https://api.telegram.org';

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured');
  }
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
}
```

- [ ] **Step 4: Implement alert message formatting**

```typescript
// src/lib/alerts/format.ts
import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

const ALERT_LABELS: Record<AlertType, string> = {
  buy_watch: 'Buy Watch',
  volume_spike: 'Volume Spike',
  liquidity_danger: 'Liquidity Danger',
  trend_break: 'Trend Break',
};

export function formatAlertMessage(alertType: AlertType, pair: DexScreenerPair): string {
  const label = ALERT_LABELS[alertType];
  const liquidity = pair.liquidity.usd.toLocaleString('en-US');
  return [
    `*${label}*: ${pair.baseToken.symbol} (${pair.baseToken.name})`,
    `Price: $${pair.priceUsd}`,
    `Liquidity: $${liquidity}`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- client.test
npm test -- format.test
```

Expected: PASS — 4 tests in the new `telegram/client.test.ts` (plus Plan 1's existing 4 in `dexscreener/client.test.ts`, also still passing), 2 tests in `format.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/ src/lib/alerts/format.ts src/lib/alerts/format.test.ts
git commit -m "feat: add Telegram client and alert message formatting"
```

---

### Task 7: Route integration — wire alerts into the cron pipeline

**Files:**
- Modify: `src/app/api/cron/scan/route.ts`
- Modify: `src/app/api/cron/scan/route.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6 (`wasRecentlyAlerted`, `insertAlert`, `markTelegramResult`, `ALERT_COOLDOWN_MINUTES` from `src/lib/db/alerts.ts`; `getPriorSnapshot`, `getLocalHighPrice` from `src/lib/scan/history.ts`; `evaluateDiscoveryAlerts` from `src/lib/alerts/rules.ts`; `formatAlertMessage` from `src/lib/alerts/format.ts`; `sendTelegramMessage` from `src/lib/telegram/client.ts`), plus everything the route already used from Plan 1.
- Produces: `POST /api/cron/scan` now returns `{ scored: number; skipped: number; total: number; alertsFired: number }` — `alertsFired` counts alerts that were both newly inserted (not in cooldown) AND successfully delivered to Telegram this tick. An alert that fires but fails Telegram delivery is still persisted (with `telegram_sent: false`) but does not increment `alertsFired`.

This task requires real credentials from Task 1 for its live end-to-end verification step (Step 4) — the unit/integration tests (Step 2) run entirely against mocked `fetch`, same as Plan 1.

- [ ] **Step 1: Write the failing test — replace the full contents of `route.test.ts`**

```typescript
// src/app/api/cron/scan/route.test.ts
import { beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

beforeEach(async () => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
  await getPool().query('truncate table alerts, token_scores, token_snapshots, tokens cascade');
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
  return new NextRequest('http://localhost/api/cron/scan', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function telegramSuccessBranch(url: string): { ok: true; text: () => Promise<string> } | undefined {
  return url.includes('api.telegram.org') ? { ok: true, text: async () => '' } : undefined;
}

describe('POST /api/cron/scan', () => {
  it('rejects requests without the correct bearer token', async () => {
    const response = await POST(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });

  it('fails closed with a 500 if CRON_SECRET is not configured, without hitting upstream', async () => {
    delete process.env.CRON_SECRET;
    const mockFetch = vi.fn(async () => {
      throw new Error('should not be called when server is misconfigured');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer undefined'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'server misconfigured' });
    expect(mockFetch).not.toHaveBeenCalled();
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
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
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

    // goodPair's volume shape (h1: 10000 against an h6/6 baseline of 5000) is
    // a 2x-over-baseline ratio, which crosses the volume_spike threshold on
    // its own — this fixture predates alert logic but its numbers happen to
    // qualify, so alertsFired: 1 is the correct expectation here, not a bug.
    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 1, total: 2, alertsFired: 1 });

    const rows = await getPool().query('select * from tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].mint_address).toBe('mint-good');
  });

  it('selects the matching, higher-liquidity pair when multiple pairs are returned', async () => {
    const wrongTokenPair = {
      chainId: 'solana',
      pairAddress: 'pair-wrong',
      baseToken: { address: 'mint-other', name: 'Other Coin', symbol: 'OTHR' },
      priceUsd: '0.001',
      priceChange: { m5: 0, h1: 10, h6: 5, h24: 20 },
      liquidity: { usd: 20000, base: 1000, quote: 1000 },
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
    const matchingPair = {
      ...wrongTokenPair,
      pairAddress: 'pair-matching',
      baseToken: { address: 'mint-target', name: 'Target Coin', symbol: 'TGT' },
      liquidity: { usd: 90000, base: 1000, quote: 1000 },
    };

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('token-profiles')) {
        return {
          ok: true,
          json: async () => [{ chainId: 'solana', tokenAddress: 'mint-target' }],
        };
      }
      if (url.includes('mint-target')) {
        return { ok: true, json: async () => [wrongTokenPair, matchingPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    // Same volume-shape reasoning as the test above — matchingPair also
    // crosses the volume_spike threshold on its own numbers.
    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 0, total: 1, alertsFired: 1 });

    const rows = await getPool().query('select * from tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].mint_address).toBe('mint-target');
    expect(rows.rows[0].pair_address).toBe('pair-matching');
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
    expect(body).toEqual({ scored: 0, skipped: 1, total: 1, alertsFired: 0 });
  });

  it('fires and delivers a buy_watch alert for a qualifying candidate', async () => {
    const buyWatchPair = {
      chainId: 'solana',
      pairAddress: 'pair-buywatch',
      baseToken: { address: 'mint-buywatch', name: 'Buy Watch Coin', symbol: 'BUYW' },
      priceUsd: '0.05',
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      liquidity: { usd: 150000, base: 1000, quote: 1000 },
      // h1 volume equals the h6-derived hourly average (300000 vs 1800000/6),
      // so this fixture fires buy_watch only, not volume_spike too — keeps
      // this test isolated to the one rule it's named for.
      volume: { h24: 1_000_000, h6: 1_800_000, h1: 300_000, m5: 10000 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      marketCap: 2_000_000,
      fdv: 2_000_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'solana', tokenAddress: 'mint-buywatch' }] };
      }
      if (url.includes('mint-buywatch')) {
        return { ok: true, json: async () => [buyWatchPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 0, total: 1, alertsFired: 1 });

    const alerts = await getPool().query('select alert_type, telegram_sent, telegram_error from alerts');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].alert_type).toBe('buy_watch');
    expect(alerts.rows[0].telegram_sent).toBe(true);
    expect(alerts.rows[0].telegram_error).toBeNull();
  });

  it('does not fire the same alert twice within the cooldown window', async () => {
    const buyWatchPair = {
      chainId: 'solana',
      pairAddress: 'pair-buywatch2',
      baseToken: { address: 'mint-buywatch2', name: 'Buy Watch Coin 2', symbol: 'BUYW2' },
      priceUsd: '0.05',
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      liquidity: { usd: 150000, base: 1000, quote: 1000 },
      volume: { h24: 1_000_000, h6: 1_800_000, h1: 300_000, m5: 10000 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      marketCap: 2_000_000,
      fdv: 2_000_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'solana', tokenAddress: 'mint-buywatch2' }] };
      }
      if (url.includes('mint-buywatch2')) {
        return { ok: true, json: async () => [buyWatchPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const first = await POST(makeRequest('Bearer test-secret'));
    const firstBody = await first.json();
    expect(firstBody.alertsFired).toBe(1);

    const second = await POST(makeRequest('Bearer test-secret'));
    const secondBody = await second.json();
    expect(secondBody.alertsFired).toBe(0);

    const alerts = await getPool().query('select alert_type from alerts');
    expect(alerts.rows).toHaveLength(1);
  });

  it('records telegram_sent=false without failing the tick when Telegram delivery fails', async () => {
    const buyWatchPair = {
      chainId: 'solana',
      pairAddress: 'pair-buywatch3',
      baseToken: { address: 'mint-buywatch3', name: 'Buy Watch Coin 3', symbol: 'BUYW3' },
      priceUsd: '0.05',
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      liquidity: { usd: 150000, base: 1000, quote: 1000 },
      volume: { h24: 1_000_000, h6: 1_800_000, h1: 300_000, m5: 10000 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 500, sells: 300 },
      },
      marketCap: 2_000_000,
      fdv: 2_000_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('api.telegram.org')) {
        return { ok: false, status: 500, text: async () => 'telegram boom' };
      }
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [{ chainId: 'solana', tokenAddress: 'mint-buywatch3' }] };
      }
      if (url.includes('mint-buywatch3')) {
        return { ok: true, json: async () => [buyWatchPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 0, total: 1, alertsFired: 0 });

    const alerts = await getPool().query('select alert_type, telegram_sent, telegram_error from alerts');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].telegram_sent).toBe(false);
    expect(alerts.rows[0].telegram_error).toContain('Telegram sendMessage failed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- route.test
```

Expected: FAIL — the existing `route.ts` doesn't return `alertsFired` and doesn't insert alert rows, so the new/updated assertions fail (existing behavior-only assertions like status codes still pass; the `toEqual` body checks and the `alerts` table queries are what fail).

- [ ] **Step 3: Implement the route changes — replace the full contents of `route.ts`**

```typescript
// src/app/api/cron/scan/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestTokenProfiles, fetchTokenPairs } from '@/lib/dexscreener/client';
import type { DexScreenerPair } from '@/lib/dexscreener/types';
import { passesHardFilter } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { upsertToken, insertSnapshot, insertScore } from '@/lib/db/tokens';
import type { ScoreBreakdown } from '@/lib/db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from '@/lib/scan/history';
import { evaluateDiscoveryAlerts } from '@/lib/alerts/rules';
import { wasRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from '@/lib/db/alerts';
import { formatAlertMessage } from '@/lib/alerts/format';
import { sendTelegramMessage } from '@/lib/telegram/client';

function selectPair(pairs: DexScreenerPair[], tokenAddress: string): DexScreenerPair | undefined {
  const matching = pairs.filter((p) => p.baseToken.address === tokenAddress);
  const candidates = matching.length > 0 ? matching : pairs;
  return candidates.reduce<DexScreenerPair | undefined>((best, p) => {
    if (!best || p.liquidity.usd > best.liquidity.usd) return p;
    return best;
  }, undefined);
}

async function evaluateAndDeliverAlerts(tokenId: string, pair: DexScreenerPair, score: ScoreBreakdown): Promise<number> {
  const [priorSnapshot, localHighPrice] = await Promise.all([
    getPriorSnapshot(tokenId),
    getLocalHighPrice(tokenId),
  ]);

  const firedTypes = evaluateDiscoveryAlerts({ pair, score, priorSnapshot, localHighPrice });
  let delivered = 0;

  for (const alertType of firedTypes) {
    const inCooldown = await wasRecentlyAlerted(tokenId, alertType, ALERT_COOLDOWN_MINUTES);
    if (inCooldown) continue;

    const alert = await insertAlert({ tokenId, alertType, payload: { score, pair } });
    try {
      await sendTelegramMessage(formatAlertMessage(alertType, pair));
      await markTelegramResult(alert.id, true, null);
      delivered++;
    } catch (err) {
      console.error(`alert: telegram send failed for ${alertType} on ${pair.pairAddress}`, err);
      await markTelegramResult(alert.id, false, (err as Error).message);
    }
  }

  return delivered;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('scan: CRON_SECRET is not configured');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

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
  let alertsFired = 0;

  for (const profile of profiles) {
    try {
      const pairs = await fetchTokenPairs(profile.tokenAddress);
      const pair = selectPair(pairs, profile.tokenAddress);

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

      try {
        alertsFired += await evaluateAndDeliverAlerts(token.id, pair, score);
      } catch (err) {
        console.error(`alert: evaluation failed for ${pair.pairAddress}`, err);
      }
    } catch (err) {
      console.error(`scan: failed to process token ${profile.tokenAddress}`, err);
      skipped++;
    }
  }

  return NextResponse.json({ scored, skipped, total: profiles.length, alertsFired });
}
```

Note the alert evaluation/delivery block has its own try/catch, separate from the outer per-token try/catch — a failure in alert evaluation or delivery must never turn a successfully-scored token into a `skipped` one. `scored++` already happened before this block runs.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- route.test
```

Expected: PASS, all 8 tests.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass across every file — this plan adds roughly 27 tests on top of Plan 1's 36 (4 in `alerts.test.ts`, 4 in `history.test.ts`, 10 in `rules.test.ts`, 4 in the new `telegram/client.test.ts`, 2 in `format.test.ts`, and a net +3 in `route.test.ts` going from 5 to 8) — verify the actual final count is in that neighborhood and 100% passing, output pristine.

- [ ] **Step 6: Manual end-to-end verification against the live DexScreener API and real Telegram**

Requires Task 1's real `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` to be in `.env.local`.

```bash
npm run dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/api/cron/scan -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Expected: JSON response with `scored`/`skipped`/`total`/`alertsFired` counts. If `alertsFired > 0`, check your Telegram chat with the bot — you should see one or more formatted alert messages arrive within a few seconds. Then confirm the DB matches:

```bash
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}" | head -1) psql -U postgres -d postgres -c "select a.alert_type, a.telegram_sent, t.symbol from alerts a join tokens t on t.id = a.token_id order by a.triggered_at desc limit 10;"
```

If `alertsFired` is 0 on this run, that's fine — it depends on what's actually trending on Solana right now, not a bug. To force a confident manual check that delivery itself works end-to-end (independent of whether any real candidate happens to qualify this tick), you may temporarily lower `BUY_WATCH_MIN_VOLUME_1H` in `src/lib/alerts/rules.ts` to something trivially easy to hit, rerun the curl, confirm a message arrives, then revert the change before committing.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/
git commit -m "feat: wire discovery alerts and Telegram delivery into cron route"
```

---

## Self-Review Notes

- **Spec coverage:** All four discovery alert types from the design spec (`2026-07-08-alerts-telegram-delivery-design.md`) are implemented with concrete, testable trigger logic. Cooldown/dedupe, Telegram delivery with graceful failure handling, and the `alerts` table's `payload` capture are all covered. Position alerts, auth, and any web UI remain explicitly out of scope per the design doc.
- **Cross-task consistency:** `AlertType` has one canonical definition (`src/lib/db/alerts.ts`, Task 3) imported everywhere else it's used (Tasks 5 and 6) — no redefinition. Buy Watch's market-cap check reuses Plan 1's `getEffectiveMarketCap` rather than re-deriving marketCap-availability logic a second time.
- **Known test-fixture interaction:** two of Plan 1's pre-existing `route.test.ts` fixtures (`goodPair`, `matchingPair`) incidentally satisfy the `volume_spike` threshold due to their own volume shape (a ~2x h1-vs-h6/6 ratio) — this isn't a bug in either plan, but Task 7's rewritten test file must account for it with the correct `alertsFired: 1` expectation on those two tests specifically (spelled out in Task 7's Step 1 code, with an inline comment at each call site) rather than silently drifting the fixtures to avoid it.
- **`alertsFired` semantics:** deliberately counts successful Telegram deliveries, not just rule firings — an alert that fires but fails to deliver is still persisted (visible via `telegram_sent`/`telegram_error` on the `alerts` row) but does not inflate the tick's reported `alertsFired` count.
