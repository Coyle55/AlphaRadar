# Coin Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a token in the discovery feed opens `/token/[mintAddress]` — its full score breakdown, a mechanical entry/stop/take-profit framework, and a price-history chart built from our own scan data.

**Architecture:** Three tasks: pure computation helpers first (display formatting, the price-change and price-chart math, the thesis calculation — all unit-tested, no DB, no UI), then the data layer (a new `getTokenDetail` query plus a small addition to the existing discovery feed query so it can link to detail pages), then the page itself (reuses the existing protected `(app)` layout, wires everything together, live-verified).

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, `pg` direct SQL (no ORM), Vitest. No new dependencies — the price chart is a plain inline SVG polyline, not a charting library.

## Global Constraints

- No new colors, fonts, or signature elements. Reuses Plan 3c's `@theme` tokens (`bg-terminal`, `bg-panel`, `text-amber`/`bg-amber`, `text-signal-green`/`bg-signal-green`, `text-signal-red`/`bg-signal-red`, `text-ink`) and IBM Plex Mono/Sans exactly as they already exist.
- `signal-green`/`signal-red` stay reserved for price-direction and score-factor-sign semantics only.
- All numeric/monetary data renders in `font-mono`.
- The detail page lives inside the existing `(app)` route group (`src/app/(app)/`) so it inherits the protected layout's auth gate and header for free — it must NOT duplicate its own `getCurrentUser()`/`redirect()` check.
- The thesis is fixed percentage bands off current price (entry = current price, stop = -15%, take-profit tiers at +50%/+100%) — deliberately mechanical, not derived from the score or any other signal. Render it under an explicit "not a prediction" framing, never phrased as advice to buy.
- The price chart uses only our own `token_snapshots` history — no external chart embed, no new dependency.
- DB-touching functions are tested against real local Postgres, same as every other DB function in this project. Pure functions (formatting, thesis math, chart-point math) get plain Vitest unit tests, no DB. The page itself is verified live against the dev server — this project has no browser-automation tooling, so that means curl-based structural verification, same adaptation as Plan 3c.
- Node 23.x, TypeScript strict mode, Next.js App Router only.

---

## File Structure

- `src/lib/format.ts` — new: `formatUsd`, `timeAgo` (moved here from `src/app/(app)/page.tsx`), `computePriceChange`
- `src/lib/scoring/thesis.ts` — new: `computeThesis`
- `src/lib/scoring/score.ts` — modified: add `MAX_POSSIBLE_SCORE` constant
- `src/lib/chart.ts` — new: `computeChartPolyline`
- `src/lib/db/discoveryFeed.ts` — modified: add `mintAddress` to `DiscoveryFeedItem`
- `src/lib/db/discoveryFeed.test.ts` — modified: assert `mintAddress` is returned
- `src/lib/db/tokenDetail.ts` — new: `getTokenDetail`
- `src/lib/db/tokenDetail.test.ts` — new
- `src/components/PriceChart.tsx` — new
- `src/app/(app)/token/[mintAddress]/page.tsx` — new
- `src/app/(app)/page.tsx` — modified: import `formatUsd`/`timeAgo` from `src/lib/format.ts` instead of defining them locally; link each row to its detail page

---

### Task 1: Shared computation helpers

**Files:**
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`
- Create: `src/lib/scoring/thesis.ts`
- Test: `src/lib/scoring/thesis.test.ts`
- Modify: `src/lib/scoring/score.ts`
- Create: `src/lib/chart.ts`
- Test: `src/lib/chart.test.ts`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Produces: `formatUsd(value: number): string`, `timeAgo(iso: string): string`, `PriceHistoryPoint { priceUsd: number; capturedAt: string }`, `PriceChange { percent: number; windowLabel: string }`, `computePriceChange(history: PriceHistoryPoint[]): PriceChange | null` — all from `src/lib/format.ts`. `Thesis { entry: number; stop: number; takeProfit1: number; takeProfit2: number }`, `computeThesis(currentPrice: number): Thesis` from `src/lib/scoring/thesis.ts`. `MAX_POSSIBLE_SCORE = 90` from `src/lib/scoring/score.ts`. `ChartPoint { priceUsd: number; capturedAt: string }`, `computeChartPolyline(history: ChartPoint[], width: number, height: number): string` from `src/lib/chart.ts`.
- Consumes: nothing new — this task is entirely new pure functions plus a mechanical extraction of two functions that already exist inline in `src/app/(app)/page.tsx`.

- [ ] **Step 1: Write the failing tests for `src/lib/format.ts`**

```typescript
// src/lib/format.test.ts
import { describe, expect, it } from "vitest";
import { formatUsd, timeAgo, computePriceChange } from "./format";

describe("formatUsd", () => {
  it("formats values a million or more with an M suffix", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50M");
  });

  it("formats values in the thousands with a K suffix", () => {
    expect(formatUsd(45_000)).toBe("$45.0K");
  });

  it("formats sub-dollar values with 6 decimal places", () => {
    expect(formatUsd(0.0012)).toBe("$0.001200");
  });

  it("formats values between 1 and 1000 with 2 decimal places", () => {
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for under a minute", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
  });

  it("returns '1m ago' for exactly one minute", () => {
    expect(timeAgo(new Date(Date.now() - 60_000).toISOString())).toBe("1m ago");
  });

  it("returns 'Nm ago' for multiple minutes", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
  });
});

describe("computePriceChange", () => {
  it("returns null with fewer than two history points", () => {
    expect(computePriceChange([])).toBeNull();
    expect(computePriceChange([{ priceUsd: 1, capturedAt: new Date().toISOString() }])).toBeNull();
  });

  it("labels the change 'since first tracked' when total history spans under 24h", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 1.0, capturedAt: new Date(now - 60 * 60_000).toISOString() },
      { priceUsd: 1.2, capturedAt: new Date(now).toISOString() },
    ];
    const change = computePriceChange(history);
    expect(change).not.toBeNull();
    expect(change!.windowLabel).toBe("since first tracked");
    expect(change!.percent).toBeCloseTo(20);
  });

  it("labels the change '24h' and uses the earliest point within the last 24h as the reference when history spans more than a day", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 0.5, capturedAt: new Date(now - 30 * 60 * 60_000).toISOString() }, // 30h ago — outside window
      { priceUsd: 1.0, capturedAt: new Date(now - 20 * 60 * 60_000).toISOString() }, // 20h ago — reference
      { priceUsd: 1.5, capturedAt: new Date(now).toISOString() },
    ];
    const change = computePriceChange(history);
    expect(change).not.toBeNull();
    expect(change!.windowLabel).toBe("24h");
    expect(change!.percent).toBeCloseTo(50); // (1.5 - 1.0) / 1.0 * 100, not against the 30h-ago point
  });

  it("returns null when the reference price is zero", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 0, capturedAt: new Date(now - 60 * 60_000).toISOString() },
      { priceUsd: 1, capturedAt: new Date(now).toISOString() },
    ];
    expect(computePriceChange(history)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- lib/format.test
```

Expected: FAIL — `./format` module doesn't exist.

- [ ] **Step 3: Implement `src/lib/format.ts`**

```typescript
// src/lib/format.ts
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1m ago";
  return `${minutes}m ago`;
}

export interface PriceHistoryPoint {
  priceUsd: number;
  capturedAt: string;
}

export interface PriceChange {
  percent: number;
  windowLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computePriceChange(history: PriceHistoryPoint[]): PriceChange | null {
  if (history.length < 2) {
    return null;
  }

  const latest = history[history.length - 1];
  const oldest = history[0];
  const latestTime = new Date(latest.capturedAt).getTime();
  const oldestTime = new Date(oldest.capturedAt).getTime();
  const dayAgoTime = latestTime - DAY_MS;

  const trackedLessThanADay = oldestTime > dayAgoTime;
  const reference = trackedLessThanADay
    ? oldest
    : history.find((point) => new Date(point.capturedAt).getTime() >= dayAgoTime) ?? oldest;

  if (reference.priceUsd === 0) {
    return null;
  }

  const percent = ((latest.priceUsd - reference.priceUsd) / reference.priceUsd) * 100;
  const windowLabel = trackedLessThanADay ? "since first tracked" : "24h";

  return { percent, windowLabel };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- lib/format.test
```

Expected: PASS, all 9 tests.

- [ ] **Step 5: Update `src/app/(app)/page.tsx` to import instead of defining locally**

Remove the local `formatUsd` and `timeAgo` function definitions (lines 4-15 of the current file) and replace the top of the file with:

```typescript
import { getDiscoveryFeed } from "@/lib/db/discoveryFeed";
import { RadarSweep } from "@/components/RadarSweep";
import { formatUsd, timeAgo } from "@/lib/format";
```

The rest of the file (the `DiscoveryFeedPage` component and everything below) stays exactly as it is for this step — Task 3 will modify it further to add links.

- [ ] **Step 6: Write the failing tests for `src/lib/scoring/thesis.ts`**

```typescript
// src/lib/scoring/thesis.test.ts
import { describe, expect, it } from "vitest";
import { computeThesis } from "./thesis";

describe("computeThesis", () => {
  it("sets entry to the current price and computes fixed percentage bands", () => {
    const thesis = computeThesis(1.0);
    expect(thesis.entry).toBe(1.0);
    expect(thesis.stop).toBeCloseTo(0.85);
    expect(thesis.takeProfit1).toBeCloseTo(1.5);
    expect(thesis.takeProfit2).toBeCloseTo(2.0);
  });

  it("scales correctly for very small meme-coin prices", () => {
    const thesis = computeThesis(0.000042);
    expect(thesis.entry).toBeCloseTo(0.000042);
    expect(thesis.stop).toBeCloseTo(0.0000357);
    expect(thesis.takeProfit1).toBeCloseTo(0.000063);
    expect(thesis.takeProfit2).toBeCloseTo(0.000084);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
npm test -- scoring/thesis.test
```

Expected: FAIL — `./thesis` module doesn't exist.

- [ ] **Step 8: Implement `src/lib/scoring/thesis.ts`**

```typescript
// src/lib/scoring/thesis.ts
export interface Thesis {
  entry: number;
  stop: number;
  takeProfit1: number;
  takeProfit2: number;
}

export function computeThesis(currentPrice: number): Thesis {
  return {
    entry: currentPrice,
    stop: currentPrice * 0.85,
    takeProfit1: currentPrice * 1.5,
    takeProfit2: currentPrice * 2.0,
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
npm test -- scoring/thesis.test
```

Expected: PASS, both tests.

- [ ] **Step 10: Add `MAX_POSSIBLE_SCORE` to `src/lib/scoring/score.ts`**

Add this export anywhere in the file (e.g. just above `scoreToken`):

```typescript
// Sum of each factor's best-case contribution: 20 + 15 + 15 + 15 + 10 + 15 + 0.
// wickRejection's only non-negative value is 0 — it never adds to the score.
export const MAX_POSSIBLE_SCORE = 90;
```

- [ ] **Step 11: Write the failing tests for `src/lib/chart.ts`**

```typescript
// src/lib/chart.test.ts
import { describe, expect, it } from "vitest";
import { computeChartPolyline } from "./chart";

describe("computeChartPolyline", () => {
  it("returns an empty string for fewer than two points", () => {
    expect(computeChartPolyline([], 600, 120)).toBe("");
    expect(
      computeChartPolyline([{ priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" }], 600, 120)
    ).toBe("");
  });

  it("maps the lowest price to the bottom and the highest to the top", () => {
    const history = [
      { priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 2, capturedAt: "2026-01-01T01:00:00.000Z" },
    ];
    const [first, second] = computeChartPolyline(history, 600, 120).split(" ");
    expect(Number(first.split(",")[1])).toBe(120);
    expect(Number(second.split(",")[1])).toBe(0);
  });

  it("spaces points evenly across the width regardless of time gaps between them", () => {
    const history = [
      { priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 1, capturedAt: "2026-01-01T00:05:00.000Z" },
      { priceUsd: 1, capturedAt: "2026-01-02T00:00:00.000Z" },
    ];
    const xs = computeChartPolyline(history, 600, 120)
      .split(" ")
      .map((point) => Number(point.split(",")[0]));
    expect(xs).toEqual([0, 300, 600]);
  });

  it("draws a flat line when all prices are identical", () => {
    const history = [
      { priceUsd: 5, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 5, capturedAt: "2026-01-01T01:00:00.000Z" },
    ];
    const ys = computeChartPolyline(history, 600, 120)
      .split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(ys[0]).toBe(120);
    expect(ys[1]).toBe(120);
  });
});
```

- [ ] **Step 12: Run the tests to verify they fail**

```bash
npm test -- lib/chart.test
```

Expected: FAIL — `./chart` module doesn't exist.

- [ ] **Step 13: Implement `src/lib/chart.ts`**

```typescript
// src/lib/chart.ts
export interface ChartPoint {
  priceUsd: number;
  capturedAt: string;
}

export function computeChartPolyline(history: ChartPoint[], width: number, height: number): string {
  if (history.length < 2) {
    return "";
  }

  const prices = history.map((point) => point.priceUsd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  return history
    .map((point, index) => {
      const x = (index / (history.length - 1)) * width;
      const y = height - ((point.priceUsd - minPrice) / priceRange) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
```

- [ ] **Step 14: Run the tests to verify they pass**

```bash
npm test -- lib/chart.test
```

Expected: PASS, all 4 tests.

- [ ] **Step 15: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass, including the existing discovery feed page's behavior (unaffected by the import-source change in Step 5 — same functions, same behavior, different file).

- [ ] **Step 16: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/lib/scoring/thesis.ts src/lib/scoring/thesis.test.ts src/lib/scoring/score.ts src/lib/chart.ts src/lib/chart.test.ts src/app/\(app\)/page.tsx
git commit -m "feat: add shared formatting, thesis, and chart-math helpers"
```

---

### Task 2: Token detail data function

**Files:**
- Modify: `src/lib/db/discoveryFeed.ts`
- Modify: `src/lib/db/discoveryFeed.test.ts`
- Create: `src/lib/db/tokenDetail.ts`
- Test: `src/lib/db/tokenDetail.test.ts`

**Interfaces:**
- Consumes: `getPool` (`src/lib/db/pool.ts`), `upsertToken`/`insertSnapshot`/`insertScore` (`src/lib/db/tokens.ts`) — used in tests.
- Produces:
  - `DiscoveryFeedItem` gains a `mintAddress: string` field (all other fields unchanged).
  - `TokenDetailSnapshotPoint { priceUsd: number; capturedAt: string }`
  - `TokenDetail { tokenId: string; mintAddress: string; symbol: string; name: string; priceUsd: number; marketCapUsd: number; liquidityUsd: number; volume1hUsd: number; volume24hUsd: number; totalScore: number; factors: ScoreFactors; capturedAt: string; priceHistory: TokenDetailSnapshotPoint[] }`
  - `getTokenDetail(mintAddress: string): Promise<TokenDetail | null>` — `null` when no token matches the mint address, or when the token exists but has never had a snapshot scored (both cases render as a 404 in Task 3). Otherwise returns the latest snapshot/score plus the full chronological price history (oldest first).

- [ ] **Step 1: Update `src/lib/db/discoveryFeed.ts` to include `mintAddress`**

Replace the file with:

```typescript
// src/lib/db/discoveryFeed.ts
import { getPool } from './pool';

export interface DiscoveryFeedItem {
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  totalScore: number;
  capturedAt: string;
}

const RECENCY_WINDOW_MINUTES = 120;
const FEED_LIMIT = 50;

export async function getDiscoveryFeed(): Promise<DiscoveryFeedItem[]> {
  const result = await getPool().query(
    `select * from (
       select distinct on (t.id)
         t.id as token_id, t.mint_address, t.symbol, t.name,
         s.price_usd, s.market_cap_usd, s.liquidity_usd, s.volume_1h_usd, s.captured_at,
         sc.total_score
       from tokens t
       join token_snapshots s on s.token_id = t.id
       join token_scores sc on sc.snapshot_id = s.id
       where s.captured_at > now() - make_interval(mins => $1)
       order by t.id, s.captured_at desc
     ) latest
     order by total_score desc
     limit $2`,
    [RECENCY_WINDOW_MINUTES, FEED_LIMIT]
  );

  return result.rows.map((row) => ({
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    priceUsd: Number(row.price_usd),
    marketCapUsd: Number(row.market_cap_usd),
    liquidityUsd: Number(row.liquidity_usd),
    volume1hUsd: Number(row.volume_1h_usd),
    totalScore: Number(row.total_score),
    capturedAt: row.captured_at.toISOString(),
  }));
}
```

- [ ] **Step 2: Add a `mintAddress` assertion to `src/lib/db/discoveryFeed.test.ts`**

In the existing `"returns tokens ordered by score descending"` test, after the existing assertions, add:

```typescript
    expect(feed[0].mintAddress).toBe('mint-feed-high');
    expect(feed[1].mintAddress).toBe('mint-feed-low');
```

- [ ] **Step 3: Run the discovery feed tests to confirm they still pass**

```bash
npm test -- db/discoveryFeed.test
```

Expected: PASS, all 4 tests (including the new assertions).

- [ ] **Step 4: Write the failing tests for `getTokenDetail`**

```typescript
// src/lib/db/tokenDetail.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, closePool } from "./pool";
import { upsertToken, insertSnapshot, insertScore } from "./tokens";
import { getTokenDetail } from "./tokenDetail";

beforeEach(async () => {
  await getPool().query("truncate table alerts, positions, token_scores, token_snapshots, tokens cascade");
});

afterAll(async () => {
  await closePool();
});

describe("getTokenDetail", () => {
  it("returns null when no token matches the mint address", async () => {
    const detail = await getTokenDetail("does-not-exist");
    expect(detail).toBeNull();
  });

  it("returns null when the token exists but has never been scanned or scored", async () => {
    await upsertToken({
      mintAddress: "mint-unscanned",
      pairAddress: "pair-unscanned",
      symbol: "UNSCAN",
      name: "Unscanned Coin",
      initialLiquidityUsd: 1000,
    });

    const detail = await getTokenDetail("mint-unscanned");
    expect(detail).toBeNull();
  });

  it("returns the latest snapshot, score factors, and full chronological price history", async () => {
    const token = await upsertToken({
      mintAddress: "mint-detail",
      pairAddress: "pair-detail",
      symbol: "DETAIL",
      name: "Detail Coin",
      initialLiquidityUsd: 50000,
    });

    const factors1 = {
      volumeMomentum: 10,
      liquidityGrowth: 5,
      priceStrength: 5,
      buySellRatio: 5,
      marketCapBand: 10,
      liquidityLevel: 15,
      wickRejection: 0,
    };
    const snapshot1Id = await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 50000,
      volume1hUsd: 5000,
      volume24hUsd: 20000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 1_000_000,
    });
    await insertScore(snapshot1Id, { total: 50, factors: factors1 });
    await getPool().query(
      `update token_snapshots set captured_at = now() - make_interval(hours => 2) where id = $1`,
      [snapshot1Id]
    );

    const factors2 = {
      volumeMomentum: 15,
      liquidityGrowth: 8,
      priceStrength: 6,
      buySellRatio: 7,
      marketCapBand: 10,
      liquidityLevel: 15,
      wickRejection: 0,
    };
    const snapshot2Id = await insertSnapshot(token.id, {
      priceUsd: 0.015,
      liquidityUsd: 60000,
      volume1hUsd: 8000,
      volume24hUsd: 30000,
      buys1h: 20,
      sells1h: 5,
      marketCapUsd: 1_500_000,
    });
    await insertScore(snapshot2Id, { total: 61, factors: factors2 });

    const detail = await getTokenDetail("mint-detail");

    expect(detail).not.toBeNull();
    expect(detail!.mintAddress).toBe("mint-detail");
    expect(detail!.symbol).toBe("DETAIL");
    expect(detail!.priceUsd).toBe(0.015);
    expect(detail!.totalScore).toBe(61);
    expect(detail!.factors).toEqual(factors2);
    expect(detail!.priceHistory).toHaveLength(2);
    expect(detail!.priceHistory[0].priceUsd).toBe(0.01);
    expect(detail!.priceHistory[1].priceUsd).toBe(0.015);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npm test -- db/tokenDetail.test
```

Expected: FAIL — `./tokenDetail` module doesn't exist.

- [ ] **Step 6: Implement `src/lib/db/tokenDetail.ts`**

```typescript
// src/lib/db/tokenDetail.ts
import { getPool } from './pool';
import type { ScoreFactors } from './tokens';

export interface TokenDetailSnapshotPoint {
  priceUsd: number;
  capturedAt: string;
}

export interface TokenDetail {
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  totalScore: number;
  factors: ScoreFactors;
  capturedAt: string;
  priceHistory: TokenDetailSnapshotPoint[];
}

export async function getTokenDetail(mintAddress: string): Promise<TokenDetail | null> {
  const tokenResult = await getPool().query(
    `select id, mint_address, symbol, name from tokens where mint_address = $1`,
    [mintAddress]
  );
  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    return null;
  }

  const [latestResult, historyResult] = await Promise.all([
    getPool().query(
      `select s.price_usd, s.market_cap_usd, s.liquidity_usd, s.volume_1h_usd, s.volume_24h_usd,
              s.captured_at, sc.total_score, sc.factors
       from token_snapshots s
       join token_scores sc on sc.snapshot_id = s.id
       where s.token_id = $1
       order by s.captured_at desc
       limit 1`,
      [tokenRow.id]
    ),
    getPool().query(
      `select price_usd, captured_at from token_snapshots where token_id = $1 order by captured_at asc`,
      [tokenRow.id]
    ),
  ]);

  const latestRow = latestResult.rows[0];
  if (!latestRow) {
    return null;
  }

  return {
    tokenId: tokenRow.id,
    mintAddress: tokenRow.mint_address,
    symbol: tokenRow.symbol,
    name: tokenRow.name,
    priceUsd: Number(latestRow.price_usd),
    marketCapUsd: Number(latestRow.market_cap_usd),
    liquidityUsd: Number(latestRow.liquidity_usd),
    volume1hUsd: Number(latestRow.volume_1h_usd),
    volume24hUsd: Number(latestRow.volume_24h_usd),
    totalScore: Number(latestRow.total_score),
    factors: latestRow.factors,
    capturedAt: latestRow.captured_at.toISOString(),
    priceHistory: historyResult.rows.map((row) => ({
      priceUsd: Number(row.price_usd),
      capturedAt: row.captured_at.toISOString(),
    })),
  };
}
```

`token_scores.factors` is a `jsonb` column — `pg` parses `jsonb` into a plain JS object automatically on read, so `latestRow.factors` is already shaped like `ScoreFactors` with no manual `JSON.parse` needed. The test in Step 4 proves this by asserting `detail!.factors` deep-equals the exact object that was passed into `insertScore`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm test -- db/tokenDetail.test
```

Expected: PASS, all 3 tests.

- [ ] **Step 8: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/discoveryFeed.ts src/lib/db/discoveryFeed.test.ts src/lib/db/tokenDetail.ts src/lib/db/tokenDetail.test.ts
git commit -m "feat: add token detail data function, expose mintAddress on discovery feed"
```

---

### Task 3: Coin Detail page

**Files:**
- Create: `src/components/PriceChart.tsx`
- Create: `src/app/(app)/token/[mintAddress]/page.tsx`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `getTokenDetail` (Task 2), `computeThesis` (Task 1), `computePriceChange`/`formatUsd` (Task 1), `computeChartPolyline` (Task 1), `MAX_POSSIBLE_SCORE` (Task 1), `RadarSweep` (Plan 3c).
- Produces: the page at `/token/[mintAddress]`. No new interfaces consumed by later tasks — this is the last task in the plan.

This task lives inside the existing `src/app/(app)/` route group, so it automatically inherits the protected layout's `getCurrentUser()`/`redirect()` auth gate and header — do not add a second auth check in this page.

- [ ] **Step 1: Create the price chart component**

```typescript
// src/components/PriceChart.tsx
import { computeChartPolyline, type ChartPoint } from "@/lib/chart";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 120;

export function PriceChart({ history }: { history: ChartPoint[] }) {
  if (history.length < 2) {
    return (
      <p className="text-sm text-ink/40">
        Not enough price history yet — check back after a few more scans.
      </p>
    );
  }

  const points = computeChartPolyline(history, CHART_WIDTH, CHART_HEIGHT);
  const prices = history.map((point) => point.priceUsd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const trackedSince = new Date(history[0].capturedAt).toLocaleString();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink/40">
        <span>Tracked since {trackedSince}</span>
        <span>
          {minPrice.toFixed(6)} – {maxPrice.toFixed(6)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Price history chart"
      >
        <polyline points={points} fill="none" className="stroke-amber" strokeWidth={2} />
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Create the Coin Detail page**

```typescript
// src/app/(app)/token/[mintAddress]/page.tsx
import { notFound } from "next/navigation";
import { getTokenDetail } from "@/lib/db/tokenDetail";
import { computeThesis } from "@/lib/scoring/thesis";
import { MAX_POSSIBLE_SCORE } from "@/lib/scoring/score";
import { formatUsd, computePriceChange } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import type { ScoreFactors } from "@/lib/db/tokens";

const FACTOR_LABELS: Record<keyof ScoreFactors, string> = {
  volumeMomentum: "Volume Momentum",
  liquidityGrowth: "Liquidity Growth",
  priceStrength: "Price Strength",
  buySellRatio: "Buy/Sell Ratio",
  marketCapBand: "Market Cap Band",
  liquidityLevel: "Liquidity Level",
  wickRejection: "Wick Rejection",
};

const FACTOR_ORDER: (keyof ScoreFactors)[] = [
  "volumeMomentum",
  "liquidityGrowth",
  "priceStrength",
  "buySellRatio",
  "marketCapBand",
  "liquidityLevel",
  "wickRejection",
];

const FACTOR_MAX_MAGNITUDE: Record<keyof ScoreFactors, number> = {
  volumeMomentum: 20,
  liquidityGrowth: 15,
  priceStrength: 15,
  buySellRatio: 15,
  marketCapBand: 10,
  liquidityLevel: 20,
  wickRejection: 15,
};

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ mintAddress: string }>;
}) {
  const { mintAddress } = await params;
  const detail = await getTokenDetail(mintAddress);

  if (!detail) {
    notFound();
  }

  const thesis = computeThesis(detail.priceUsd);
  const priceChange = computePriceChange(detail.priceHistory);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <section className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-2xl text-ink">{detail.symbol}</div>
          <div className="text-sm text-ink/50">{detail.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl text-ink">{formatUsd(detail.priceUsd)}</div>
          {priceChange && (
            <div
              className={`font-mono text-sm ${
                priceChange.percent >= 0 ? "text-signal-green" : "text-signal-red"
              }`}
            >
              {priceChange.percent >= 0 ? "+" : ""}
              {priceChange.percent.toFixed(1)}% {priceChange.windowLabel}
            </div>
          )}
        </div>
      </section>

      <section className="mb-8 flex flex-wrap items-center gap-8 border-b border-ink/10 pb-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Score</div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-xl text-ink">{detail.totalScore.toFixed(1)}</span>
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-amber"
                style={{
                  width: `${Math.max(4, Math.min(100, (detail.totalScore / MAX_POSSIBLE_SCORE) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Liquidity</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.liquidityUsd)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">24h Volume</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.volume24hUsd)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Market Cap</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.marketCapUsd)}</div>
        </div>
      </section>

      <section className="mb-8 border-b border-ink/10 pb-6">
        <PriceChart history={detail.priceHistory} />
      </section>

      <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-xs uppercase tracking-wide text-ink/40">Score Breakdown</h2>
          <div className="flex flex-col gap-3">
            {FACTOR_ORDER.map((key) => {
              const value = detail.factors[key];
              const max = FACTOR_MAX_MAGNITUDE[key];
              const width = Math.min(100, (Math.abs(value) / max) * 100);
              const positive = value >= 0;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-ink/70">{FACTOR_LABELS[key]}</span>
                    <span className={`font-mono ${positive ? "text-signal-green" : "text-signal-red"}`}>
                      {positive ? "+" : ""}
                      {value.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
                    <div
                      className={`h-full rounded-full ${positive ? "bg-signal-green" : "bg-signal-red"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-1 text-xs uppercase tracking-wide text-amber">
            Mechanical Framework — Not a Prediction
          </h2>
          <p className="mb-4 text-xs text-ink/40">
            Fixed percentage bands off current price. Not a signal to buy — a framework for
            managing risk if you do.
          </p>
          <div className="flex flex-col gap-3 font-mono text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Entry (current price)</span>
              <span className="text-ink">{formatUsd(thesis.entry)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Stop (-15%)</span>
              <span className="text-signal-red">{formatUsd(thesis.stop)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Take-Profit 1 (+50%)</span>
              <span className="text-signal-green">{formatUsd(thesis.takeProfit1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Take-Profit 2 (+100%)</span>
              <span className="text-signal-green">{formatUsd(thesis.takeProfit2)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Link each discovery feed row to its detail page**

In `src/app/(app)/page.tsx`, add the import and wrap the token cell's content in a link. First add to the imports at the top:

```typescript
import Link from "next/link";
```

Then replace this block:

```typescript
              <td className="py-3 pr-4">
                <div className="font-medium text-ink">{item.symbol}</div>
                <div className="text-xs text-ink/40">{item.name}</div>
              </td>
```

with:

```typescript
              <td className="py-3 pr-4">
                <Link href={`/token/${item.mintAddress}`} className="block hover:text-amber">
                  <div className="font-medium text-ink">{item.symbol}</div>
                  <div className="text-xs text-ink/40">{item.name}</div>
                </Link>
              </td>
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 5: Build verification**

```bash
npm run build
```

Expected: succeeds with no errors. Confirm the route table includes `ƒ /token/[mintAddress]` as a dynamic route.

- [ ] **Step 6: Live end-to-end verification**

This project has no browser-automation tooling, so this step uses `curl` with a cookie jar to log in, then exercises the real flow — the same adaptation used for Plan 3c's live verification.

```bash
npm run dev
```

In another terminal, with a cookie jar and real login credentials for a user that already exists in your local Supabase Auth (reuse one created during Plan 3c's verification, or sign up a fresh one via `curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'`):

1. `curl -s -c cookies.txt -b cookies.txt http://localhost:3000/` — confirm the discovery feed renders. If it has at least one real scored token, note its mint address from the page's structural content (or query Postgres directly: `psql "$DATABASE_URL" -c "select mint_address from tokens limit 1;"`).
2. `curl -s -i -b cookies.txt "http://localhost:3000/token/{that mint address}"` — confirm a 200 response containing the token's symbol, the "MECHANICAL FRAMEWORK" eyebrow text, all 7 factor labels (Volume Momentum, Liquidity Growth, Price Strength, Buy/Sell Ratio, Market Cap Band, Liquidity Level, Wick Rejection), and either the SVG polyline (`<polyline`) or the "Not enough price history yet" message, depending on how many snapshots that token actually has.
3. `curl -s -i -b cookies.txt "http://localhost:3000/token/definitely-not-a-real-mint-address"` — confirm a 404 response.
4. `curl -s -i "http://localhost:3000/token/{any mint address}"` **without** the cookie jar — confirm this redirects to `/login` (proving the route inherits the `(app)` layout's auth gate rather than being separately/incorrectly public).
5. Stop the dev server when done.

Report the actual HTTP statuses and response content observed for each of the 4 checks — don't assume they pass without checking.

- [ ] **Step 7: Commit**

```bash
git add src/components/PriceChart.tsx "src/app/(app)/token" "src/app/(app)/page.tsx"
git commit -m "feat: add coin detail page with score breakdown, thesis, and price chart"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the design spec (masthead, price chart with sparse-history handling, score breakdown ordered per `score.ts`, thesis with explicit "not a prediction" framing, 404 for never-scanned tokens, live verification) has a corresponding step. Out-of-scope items (position CTA, alert history, external chart source, thesis editing, history backfill) are genuinely absent — nothing in this plan touches positions, alerts, or external APIs.
- **Data invariant found during planning, not in the original spec:** the spec assumed "a token can't have a snapshot without a score," carried over from the discovery feed's invariant — but `POST /api/positions` (Plan 3b) calls `upsertToken` without ever calling `insertSnapshot`/`insertScore`, so a token row can exist with zero snapshots (reachable today only via direct URL entry, since no UI links to unscanned tokens yet). `getTokenDetail` returns `null` for this case, which the spec's own wording already covers ("a token we've ever scanned") — Task 2's second test (`"returns null when the token exists but has never been scanned or scored"`) exists specifically to pin this down.
- **Corrected a scaling bug from the design spec itself:** the spec's first draft listed `liquidityLevel`'s max magnitude as 15; `score.ts` shows its actual range is +15/0/-20, so the correct magnitude for bar-scaling is 20. Fixed in the spec before this plan was written, and `FACTOR_MAX_MAGNITUDE` in Task 3 uses the corrected value.
- **Type consistency:** `TokenDetailSnapshotPoint` (Task 2) and `ChartPoint`/`PriceHistoryPoint` (Task 1) are structurally identical but intentionally separate types — Task 1's pure `format.ts`/`chart.ts` modules don't import from the DB layer, so they declare their own minimal shape; TypeScript's structural typing accepts `TokenDetail.priceHistory` at both call sites in Task 3 without any cast. `ScoreFactors` (Task 3's `FACTOR_LABELS`/`FACTOR_ORDER`/`FACTOR_MAX_MAGNITUDE`) is imported from `src/lib/db/tokens.ts`, the single canonical source, not redefined.
- **MAX_POSSIBLE_SCORE placement:** lives in `score.ts` next to the factor formulas it's derived from, not duplicated as a magic number in the page, so it can't silently drift out of sync if the scoring model changes.
