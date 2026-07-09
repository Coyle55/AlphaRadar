# Alerts Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `/alerts` page showing the global discovery-alert feed and the current user's own position-alert history — the last of the four dashboard pages from the original scope.

**Architecture:** Two tasks: first, two new read functions in the existing `src/lib/db/alerts.ts` (one global, one per-user, both reading trigger-time price/liquidity straight out of the alert's already-stored payload — no live lookups); second, the page itself (two sections, a new nav link, live verification). No client components are needed anywhere in this plan — every row is read-only display, so the whole page stays a plain Server Component.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, `pg` direct SQL, Vitest. No new dependencies.

## Global Constraints

- No new colors, fonts, or signature elements. `signal-green`/`signal-red` are reused for alert severity (`buy_watch`/`volume_spike`/`take_profit` = green, `liquidity_danger`/`trend_break`/`exit_warning` = red) — this is a direct extension of the same signal-direction semantics those tokens already carry, not an unrelated new use.
- All numeric/monetary data (price, liquidity) renders in `font-mono`.
- Alert type labels reuse `ALERT_LABELS` from `src/lib/alerts/format.ts` verbatim — do not redefine or restate them.
- Price/liquidity shown per alert come from the alert's stored `payload` (trigger-time snapshot), never a live DexScreener lookup — an alert's history should never silently change after the fact.
- `getPositionAlertsForUser` must scope strictly by `user_id` — a position alert never appears for any user other than its owner. This is the second per-user-scoped read in the app (after Watchlist), and gets the same cross-user-isolation test scrutiny that plan required.
- `getDiscoveryAlerts` must only return alerts with `user_id is null` — it must never include a user-scoped position alert.
- The `/alerts` page lives inside the existing `(app)` route group and must NOT add its own full auth gate beyond calling `getCurrentUser()` to get the user's `id` for scoping — the route group's layout already redirects unauthenticated requests.
- DB-touching functions are tested against real local Postgres, same as every function in this project. The page itself is verified live via curl against the real dev server — no browser-automation tooling exists in this project.
- Node 23.x, TypeScript strict mode, Next.js App Router only.

---

## File Structure

- `src/lib/db/alerts.ts` — modified: add `AlertFeedItem`, `getDiscoveryAlerts`, `getPositionAlertsForUser`
- `src/lib/db/alerts.test.ts` — modified: append test coverage for both new functions
- `src/app/(app)/layout.tsx` — modified: add an "Alerts" nav link
- `src/app/(app)/alerts/page.tsx` — new

---

### Task 1: Alert feed data functions

**Files:**
- Modify: `src/lib/db/alerts.ts`
- Modify: `src/lib/db/alerts.test.ts`

**Interfaces:**
- Consumes: `upsertToken`/`insertAlert` (already exist in this file and `tokens.ts`), `insertPosition` (`src/lib/db/positions.ts`), `createTestUser` (`src/lib/testing/testUser.ts`) — all already imported in the existing test file.
- Produces: `AlertFeedItem { id: string; tokenId: string; mintAddress: string; symbol: string; name: string; alertType: AlertType; triggeredAt: string; priceUsd: number; liquidityUsd: number }`, `getDiscoveryAlerts(): Promise<AlertFeedItem[]>`, `getPositionAlertsForUser(userId: string): Promise<AlertFeedItem[]>`.

- [ ] **Step 1: Write the failing tests**

Append these two `describe` blocks to the end of `src/lib/db/alerts.test.ts` (the file already imports `insertAlert`, `upsertToken`, `insertPosition`, `createTestUser`, and defines `fakeScore`/`fakePair` fixtures — reuse them). Add `getDiscoveryAlerts` and `getPositionAlertsForUser` to the existing import from `./alerts`:

```typescript
import {
  wasRecentlyAlerted,
  insertAlert,
  markTelegramResult,
  ALERT_COOLDOWN_MINUTES,
  wasPositionRecentlyAlerted,
  getDiscoveryAlerts,
  getPositionAlertsForUser,
} from './alerts';
```

```typescript
describe('getDiscoveryAlerts', () => {
  it('returns only alerts with no user_id, most recent first', async () => {
    const user = await createTestUser();
    const discoveryToken = await upsertToken({
      mintAddress: 'mint-feed-discovery-1',
      pairAddress: 'pair-feed-discovery-1',
      symbol: 'DISC1',
      name: 'Discovery Coin 1',
      initialLiquidityUsd: 50000,
    });
    const positionToken = await upsertToken({
      mintAddress: 'mint-feed-position-1',
      pairAddress: 'pair-feed-position-1',
      symbol: 'POSF1',
      name: 'Position Feed Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: positionToken.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    await insertAlert({
      tokenId: discoveryToken.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });
    await insertAlert({
      tokenId: positionToken.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(1);
    expect(feed[0].symbol).toBe('DISC1');
    expect(feed[0].alertType).toBe('buy_watch');
  });

  it('reads price and liquidity from the stored payload snapshot', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-feed-discovery-2',
      pairAddress: 'pair-feed-discovery-2',
      symbol: 'DISC2',
      name: 'Discovery Coin 2',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'volume_spike',
      payload: {
        score: fakeScore,
        pair: { ...fakePair, priceUsd: '0.0042', liquidity: { usd: 77777, base: 1, quote: 1 } },
      },
    });

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(1);
    expect(feed[0].priceUsd).toBe(0.0042);
    expect(feed[0].liquidityUsd).toBe(77777);
  });

  it('caps results at 50', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-feed-discovery-cap',
      pairAddress: 'pair-feed-discovery-cap',
      symbol: 'CAP',
      name: 'Cap Coin',
      initialLiquidityUsd: 50000,
    });

    for (let i = 0; i < 55; i++) {
      await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });
    }

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(50);
  });
});

describe('getPositionAlertsForUser', () => {
  it("returns only the requesting user's alerts, excluding discovery alerts and other users' alerts", async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-feed-position-2',
      pairAddress: 'pair-feed-position-2',
      symbol: 'POSF2',
      name: 'Position Feed Coin 2',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });
    const otherPosition = await insertPosition({
      userId: otherUser.id,
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
    await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: otherUser.id,
      positionId: otherPosition.id,
    });
    await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });

    const feed = await getPositionAlertsForUser(user.id);

    expect(feed).toHaveLength(1);
    expect(feed[0].alertType).toBe('exit_warning');
  });

  it('returns an empty array for a user with no position alerts', async () => {
    const user = await createTestUser();
    const feed = await getPositionAlertsForUser(user.id);
    expect(feed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- db/alerts.test
```

Expected: FAIL — `getDiscoveryAlerts`/`getPositionAlertsForUser` don't exist yet.

- [ ] **Step 3: Add the new functions to `src/lib/db/alerts.ts`**

Append this to the end of the file:

```typescript
export interface AlertFeedItem {
  id: string;
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  alertType: AlertType;
  triggeredAt: string;
  priceUsd: number;
  liquidityUsd: number;
}

const ALERT_FEED_LIMIT = 50;

function mapAlertFeedRow(row: any): AlertFeedItem {
  const payload = row.payload as AlertPayload;
  return {
    id: row.id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    alertType: row.alert_type,
    triggeredAt: row.triggered_at.toISOString(),
    priceUsd: parseFloat(payload.pair.priceUsd),
    liquidityUsd: payload.pair.liquidity?.usd ?? 0,
  };
}

export async function getDiscoveryAlerts(): Promise<AlertFeedItem[]> {
  const result = await getPool().query(
    `select a.id, a.token_id, t.mint_address, t.symbol, t.name, a.alert_type, a.triggered_at, a.payload
     from alerts a
     join tokens t on t.id = a.token_id
     where a.user_id is null
     order by a.triggered_at desc
     limit $1`,
    [ALERT_FEED_LIMIT]
  );
  return result.rows.map(mapAlertFeedRow);
}

export async function getPositionAlertsForUser(userId: string): Promise<AlertFeedItem[]> {
  const result = await getPool().query(
    `select a.id, a.token_id, t.mint_address, t.symbol, t.name, a.alert_type, a.triggered_at, a.payload
     from alerts a
     join tokens t on t.id = a.token_id
     where a.user_id = $1
     order by a.triggered_at desc
     limit $2`,
    [userId, ALERT_FEED_LIMIT]
  );
  return result.rows.map(mapAlertFeedRow);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- db/alerts.test
```

Expected: PASS, all tests (the pre-existing ones plus the 5 new ones).

- [ ] **Step 5: Run the full test suite and confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/alerts.ts src/lib/db/alerts.test.ts
git commit -m "feat: add discovery and per-user position alert feed queries"
```

---

### Task 2: The Alerts page

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/alerts/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (Plan 3a), `getDiscoveryAlerts`/`getPositionAlertsForUser` (Task 1), `ALERT_LABELS` (`src/lib/alerts/format.ts`), `formatUsd`/`timeAgo` (`src/lib/format.ts`).

- [ ] **Step 1: Add the "Alerts" nav link**

In `src/app/(app)/layout.tsx`, add one `Link` after the existing "Positions" link (inside the `<nav>` block):

```typescript
          <Link href="/positions" className="text-sm text-ink/60 hover:text-amber">
            Positions
          </Link>
          <Link href="/alerts" className="text-sm text-ink/60 hover:text-amber">
            Alerts
          </Link>
```

No other changes to this file — `Link` is already imported.

- [ ] **Step 2: Create the Alerts page**

```typescript
// src/app/(app)/alerts/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getDiscoveryAlerts, getPositionAlertsForUser, type AlertFeedItem, type AlertType } from "@/lib/db/alerts";
import { ALERT_LABELS } from "@/lib/alerts/format";
import { formatUsd, timeAgo } from "@/lib/format";

const POSITIVE_ALERT_TYPES: AlertType[] = ["buy_watch", "volume_spike", "take_profit"];

function alertColorClass(alertType: AlertType): string {
  return POSITIVE_ALERT_TYPES.includes(alertType) ? "text-signal-green" : "text-signal-red";
}

function AlertRowContent({ alert }: { alert: AlertFeedItem }) {
  return (
    <>
      <span className={`w-32 shrink-0 ${alertColorClass(alert.alertType)}`}>{ALERT_LABELS[alert.alertType]}</span>
      <span className="flex-1 truncate text-ink">
        {alert.symbol} <span className="text-ink/40">{alert.name}</span>
      </span>
      <span className="shrink-0 text-ink/70">{formatUsd(alert.priceUsd)}</span>
      <span className="shrink-0 text-ink/70">{formatUsd(alert.liquidityUsd)}</span>
      <span className="w-20 shrink-0 text-right text-ink/40">{timeAgo(alert.triggeredAt)}</span>
    </>
  );
}

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [discoveryAlerts, positionAlerts] = await Promise.all([
    getDiscoveryAlerts(),
    getPositionAlertsForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Discovery Alerts</h2>
        {discoveryAlerts.length === 0 ? (
          <p className="text-sm text-ink/50">No discovery alerts yet.</p>
        ) : (
          <div className="flex flex-col font-mono text-sm">
            {discoveryAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/token/${alert.mintAddress}`}
                className="flex items-center justify-between gap-4 border-t border-ink/10 py-3 first:border-t-0 hover:bg-ink/5"
              >
                <AlertRowContent alert={alert} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Your Position Alerts</h2>
        {positionAlerts.length === 0 ? (
          <p className="text-sm text-ink/50">No position alerts yet.</p>
        ) : (
          <div className="flex flex-col font-mono text-sm">
            {positionAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-4 border-t border-ink/10 py-3 first:border-t-0">
                <AlertRowContent alert={alert} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

`AlertRowContent` is a small local component factoring out the shared cell markup between the two sections — Discovery rows wrap it in a `Link` (clickable, per the design), position-alert rows wrap it in a plain `div` (no link target exists for a single position yet). This avoids duplicating five `<span>` cells twice while still letting each section choose its own wrapper element.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all pass, no regressions.

- [ ] **Step 4: Build verification**

```bash
npm run build
```

Expected: succeeds with no errors. Confirm the route table includes `ƒ /alerts`.

- [ ] **Step 5: Live end-to-end verification**

Same curl + cookie-jar adaptation used in the last three plans (no browser-automation tooling in this project):

```bash
npm run dev
```

In another terminal:

1. Sign up a fresh test user via curl with a cookie jar to get a valid session.
2. `curl -s -b cookies.txt http://localhost:3000/alerts` — confirm 200. A fresh user/fresh local DB will likely show "No discovery alerts yet" and "No position alerts yet" — that's expected and valid; if your local DB already has alerts from earlier scan-pipeline testing, confirm the Discovery Alerts section renders them instead, with correct labels/colors.
3. If your local DB has zero alerts of any kind (a common case on a fresh dev setup), seed one directly to verify rendering: `psql "$DATABASE_URL" -c "insert into alerts (token_id, alert_type, payload) select id, 'buy_watch', '{\"score\":{\"total\":10,\"factors\":{\"volumeMomentum\":5,\"liquidityGrowth\":0,\"priceStrength\":0,\"buySellRatio\":0,\"marketCapBand\":5,\"liquidityLevel\":0,\"wickRejection\":0}},\"pair\":{\"chainId\":\"solana\",\"pairAddress\":\"test-pair\",\"baseToken\":{\"address\":\"test-mint\",\"name\":\"Test\",\"symbol\":\"TST\"},\"priceUsd\":\"0.01\",\"priceChange\":{\"m5\":0,\"h1\":0,\"h6\":0,\"h24\":0},\"liquidity\":{\"usd\":50000,\"base\":1,\"quote\":1},\"volume\":{\"h24\":0,\"h6\":0,\"h1\":0,\"m5\":0},\"txns\":{\"m5\":{\"buys\":0,\"sells\":0},\"h1\":{\"buys\":0,\"sells\":0},\"h6\":{\"buys\":0,\"sells\":0},\"h24\":{\"buys\":0,\"sells\":0}},\"marketCap\":1000000,\"fdv\":1000000,\"pairCreatedAt\":0}}'::jsonb from tokens limit 1;"` then re-check `/alerts` and confirm the row appears with a green "Buy Watch" label and a working link to that token's Coin Detail page.
4. `curl -s -i http://localhost:3000/alerts` **without** the cookie jar — confirm a redirect to `/login`.
5. Stop the dev server when done.

Report the actual HTTP statuses and rendered content you observed for each step.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/layout.tsx" "src/app/(app)/alerts"
git commit -m "feat: add Alerts page with discovery and position alert feeds"
```

---

## Self-Review Notes

- **Spec coverage:** both sections, the color-by-severity mapping, payload-snapshot pricing (no live lookups), discovery-alert linking to Coin Detail, empty states, and the nav link are all covered. Out-of-scope items (read/unread state, type filtering, real-time updates, alert preferences) are genuinely absent — nothing in this plan's two tasks touches any of them.
- **Reuse discipline:** `ALERT_LABELS`, `formatUsd`, `timeAgo` are all imported from their existing canonical locations, not redefined. The existing `fakeScore`/`fakePair` test fixtures in `alerts.test.ts` are reused rather than duplicated.
- **Type consistency:** `AlertFeedItem` (Task 1) is consumed as-is by `AlertRowContent` (Task 2) with no redefinition or field-name drift.
- **No new client components:** every part of this plan is a plain Server Component — there's no interactive state anywhere on this page (no forms, no client-side actions), unlike Watchlist's log/close flows.
