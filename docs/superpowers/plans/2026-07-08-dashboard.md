# Auth UI & Discovery Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Login/signup pages and a protected discovery feed as the home screen — the first UI this product has ever had, and the first thing exposing scored tokens for reading rather than just writing them.

**Architecture:** Four tasks: design tokens and global styles first (so every later page inherits the right look with zero rework), a discovery-feed data function (Server Component calls it directly — no new API route, since nothing else consumes this data yet), the auth forms (Client Components against Plan 3a's already-working API routes), and finally the protected layout + discovery feed page, wired together and verified live in a browser.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 (CSS-first `@theme` config, no `tailwind.config.js`), IBM Plex Mono + IBM Plex Sans via `next/font/google`, local Supabase (Postgres + Auth), Vitest for the one DB-touching data function this plan adds.

## Global Constraints

- No light mode. This product commits to one dark terminal aesthetic — don't add a `prefers-color-scheme` branch or a theme toggle.
- All monetary/numeric data (price, volume, liquidity, market cap, score) renders in `font-mono` (IBM Plex Mono) for tabular alignment — this is a real trading-terminal convention, not a stylistic afterthought.
- `signal-green`/`signal-red` are reserved for price-direction/bullish-bearish semantics only — never used as arbitrary accent colors elsewhere in the UI.
- Protected pages check auth server-side via `getCurrentUser()` (Plan 3a) + `redirect()` from `next/navigation` — never a client-side auth check that flashes unauthenticated content before redirecting.
- UI pages/components are verified live in a real browser against the real dev server — this project has no component-testing infrastructure (no `@testing-library/react`, no jsdom environment configured), and introducing one is out of scope for this plan. The one piece of this plan that's genuine backend logic (the discovery feed's data function) IS tested with Vitest against real local Postgres, same as every DB-touching function in every prior plan.
- Node 23.x, TypeScript strict mode, Next.js App Router only.

---

## File Structure

- `src/app/globals.css` — modified: design tokens (`@theme`), radar-sweep keyframes
- `src/app/layout.tsx` — modified: load IBM Plex Mono/Sans, apply terminal background
- `src/components/RadarSweep.tsx` — new: the signature visual element, reused at different sizes
- `src/lib/db/discoveryFeed.ts` — new: `getDiscoveryFeed()`
- `src/app/login/page.tsx` — new
- `src/app/signup/page.tsx` — new
- `src/components/LogoutButton.tsx` — new
- `src/app/(app)/layout.tsx` — new: protected-area layout (auth check, header, logout)
- `src/app/(app)/page.tsx` — new: the discovery feed (replaces the default `src/app/page.tsx`, which is deleted)
- `src/app/page.tsx` — **deleted** (its route is taken over by `src/app/(app)/page.tsx`, since a route group's parentheses don't appear in the URL)

---

### Task 1: Design tokens and global styles

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/RadarSweep.tsx`

**Interfaces:**
- Produces: Tailwind utilities `bg-terminal`, `bg-panel`, `bg-amber`/`text-amber`/`border-amber`, `text-signal-green`, `text-signal-red`, `text-ink`/`bg-ink`, plus `font-mono`/`font-sans` now resolving to IBM Plex Mono/Sans project-wide. `RadarSweep({ size?: number })` — a reusable animated component (default size shown large as an ambient/hero element on auth pages; a small size doubles as a functional freshness indicator in Task 4's header).

- [ ] **Step 1: Replace `src/app/globals.css`**

The current file supports light/dark toggling via `prefers-color-scheme`, inherited from `create-next-app`'s default template — this product commits to one dark aesthetic, so that branching goes away entirely.

```css
@import "tailwindcss";

@theme {
  --color-terminal: #0B0D0E;
  --color-panel: #14171A;
  --color-amber: #FFB000;
  --color-signal-green: #3DDC84;
  --color-signal-red: #FF4D4D;
  --color-ink: #EDEDE8;
  --font-mono: var(--font-plex-mono);
  --font-sans: var(--font-plex-sans);
}

body {
  background-color: var(--color-terminal);
  color: var(--color-ink);
}

@keyframes radar-sweep {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 2: Replace `src/app/layout.tsx`**

```typescript
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AlphaRadar",
  description: "Solana meme-coin scanner",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plexMono.variable} ${plexSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-terminal font-sans text-ink">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create the RadarSweep component**

```typescript
// src/components/RadarSweep.tsx
export function RadarSweep({ size = 120 }: { size?: number }) {
  const ringInset = Math.round(size * 0.15);

  return (
    <div
      className="relative shrink-0 rounded-full border border-amber/30"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div
        className="absolute rounded-full border border-amber/10"
        style={{ inset: ringInset }}
      />
      <div
        className="absolute inset-0 origin-center"
        style={{ animation: "radar-sweep 4s linear infinite" }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-gradient-to-b from-amber to-transparent"
          style={{ transform: "translateX(-50%)" }}
        />
      </div>
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber" />
    </div>
  );
}
```

- [ ] **Step 4: Verify the build succeeds**

```bash
npm run build
```

Expected: succeeds with no errors. There's no meaningful visual surface to check yet (the existing `src/app/page.tsx` is still the unmodified `create-next-app` boilerplate) — Task 3 is where this design system first becomes visible in a browser.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/RadarSweep.tsx
git commit -m "feat: add terminal design tokens, fonts, and radar-sweep component"
```

---

### Task 2: Discovery feed data function

**Files:**
- Create: `src/lib/db/discoveryFeed.ts`
- Test: `src/lib/db/discoveryFeed.test.ts`

**Interfaces:**
- Consumes: `getPool`/`closePool` (`src/lib/db/pool.ts`), `upsertToken`/`insertSnapshot`/`insertScore` (`src/lib/db/tokens.ts`, Plan 1) — used in tests to seed fixtures.
- Produces:
  - `DiscoveryFeedItem { tokenId: string; symbol: string; name: string; priceUsd: number; marketCapUsd: number; liquidityUsd: number; volume1hUsd: number; totalScore: number; capturedAt: string }`
  - `getDiscoveryFeed(): Promise<DiscoveryFeedItem[]>` — each token's most recent score, filtered to snapshots captured within the last 2 hours, ordered by score descending, capped at 50. Task 4's discovery feed page calls this directly (no API route — nothing else consumes this data in this plan).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/db/discoveryFeed.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken, insertSnapshot, insertScore } from './tokens';
import { getDiscoveryFeed } from './discoveryFeed';

async function seedTokenWithScore(params: {
  mintAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  totalScore: number;
  capturedAtMinutesAgo: number;
}) {
  const token = await upsertToken({
    mintAddress: params.mintAddress,
    pairAddress: params.pairAddress,
    symbol: params.symbol,
    name: params.name,
    initialLiquidityUsd: 50000,
  });

  const snapshotId = await insertSnapshot(token.id, {
    priceUsd: 0.01,
    liquidityUsd: 50000,
    volume1hUsd: 10000,
    volume24hUsd: 50000,
    buys1h: 10,
    sells1h: 5,
    marketCapUsd: 1_000_000,
  });

  await insertScore(snapshotId, {
    total: params.totalScore,
    factors: {
      volumeMomentum: params.totalScore,
      liquidityGrowth: 0,
      priceStrength: 0,
      buySellRatio: 0,
      marketCapBand: 0,
      liquidityLevel: 0,
      wickRejection: 0,
    },
  });

  if (params.capturedAtMinutesAgo > 0) {
    await getPool().query(
      `update token_snapshots set captured_at = now() - make_interval(mins => $1) where id = $2`,
      [params.capturedAtMinutesAgo, snapshotId]
    );
  }

  return token;
}

beforeEach(async () => {
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('getDiscoveryFeed', () => {
  it('returns tokens ordered by score descending', async () => {
    await seedTokenWithScore({
      mintAddress: 'mint-feed-low',
      pairAddress: 'pair-feed-low',
      symbol: 'LOW',
      name: 'Low Score Coin',
      totalScore: 5,
      capturedAtMinutesAgo: 0,
    });
    await seedTokenWithScore({
      mintAddress: 'mint-feed-high',
      pairAddress: 'pair-feed-high',
      symbol: 'HIGH',
      name: 'High Score Coin',
      totalScore: 50,
      capturedAtMinutesAgo: 0,
    });

    const feed = await getDiscoveryFeed();

    expect(feed).toHaveLength(2);
    expect(feed[0].symbol).toBe('HIGH');
    expect(feed[1].symbol).toBe('LOW');
  });

  it('excludes tokens scored outside the recency window', async () => {
    await seedTokenWithScore({
      mintAddress: 'mint-feed-stale',
      pairAddress: 'pair-feed-stale',
      symbol: 'STALE',
      name: 'Stale Coin',
      totalScore: 100,
      capturedAtMinutesAgo: 180,
    });

    const feed = await getDiscoveryFeed();

    expect(feed.find((item) => item.symbol === 'STALE')).toBeUndefined();
  });

  it('returns only the most recent score when a token has multiple snapshots', async () => {
    const token = await seedTokenWithScore({
      mintAddress: 'mint-feed-multi',
      pairAddress: 'pair-feed-multi',
      symbol: 'MULTI',
      name: 'Multi Snapshot Coin',
      totalScore: 10,
      capturedAtMinutesAgo: 60,
    });

    const snapshotId = await insertSnapshot(token.id, {
      priceUsd: 0.02,
      liquidityUsd: 60000,
      volume1hUsd: 20000,
      volume24hUsd: 80000,
      buys1h: 20,
      sells1h: 5,
      marketCapUsd: 2_000_000,
    });
    await insertScore(snapshotId, {
      total: 30,
      factors: {
        volumeMomentum: 30,
        liquidityGrowth: 0,
        priceStrength: 0,
        buySellRatio: 0,
        marketCapBand: 0,
        liquidityLevel: 0,
        wickRejection: 0,
      },
    });

    const feed = await getDiscoveryFeed();

    expect(feed).toHaveLength(1);
    expect(feed[0].totalScore).toBe(30);
    expect(feed[0].priceUsd).toBe(0.02);
  });

  it('returns an empty array when no tokens have been scored recently', async () => {
    const feed = await getDiscoveryFeed();
    expect(feed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- db/discoveryFeed.test
```

Expected: FAIL — `./discoveryFeed` module doesn't exist.

- [ ] **Step 3: Implement the data function**

```typescript
// src/lib/db/discoveryFeed.ts
import { getPool } from './pool';

export interface DiscoveryFeedItem {
  tokenId: string;
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
         t.id as token_id, t.symbol, t.name,
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

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- db/discoveryFeed.test
```

Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/discoveryFeed.ts src/lib/db/discoveryFeed.test.ts
git commit -m "feat: add discovery feed data function"
```

---

### Task 3: Login and signup pages

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/signup/page.tsx`

**Interfaces:**
- Consumes: `RadarSweep` (Task 1), Plan 3a's existing `POST /api/auth/login` / `POST /api/auth/signup` routes (no backend changes).
- Produces: two pages at `/login` and `/signup`. Both redirect to `/` on success via `router.push('/') + router.refresh()` (the `refresh()` is required — without it, Next.js can serve a cached Server Component payload from before the session cookie was set).

- [ ] **Step 1: Create the login page**

```typescript
// src/app/login/page.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RadarSweep } from "@/components/RadarSweep";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4">
      <RadarSweep size={96} />
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-mono text-2xl tracking-wide text-amber">ALPHARADAR</h1>
        <p className="mb-8 text-center text-sm text-ink/60">Log in to your radar</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          {error && <p className="text-sm text-signal-red">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded bg-amber px-4 py-2 font-medium text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-ink/60">
          No account?{" "}
          <Link href="/signup" className="text-amber hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the signup page**

```typescript
// src/app/signup/page.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RadarSweep } from "@/components/RadarSweep";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4">
      <RadarSweep size={96} />
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-mono text-2xl tracking-wide text-amber">ALPHARADAR</h1>
        <p className="mb-8 text-center text-sm text-ink/60">Create your account</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          {error && <p className="text-sm text-signal-red">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded bg-amber px-4 py-2 font-medium text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="text-amber hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Live-check both pages render correctly**

```bash
npm run dev
```

Visit `http://localhost:3000/login` and `http://localhost:3000/signup` in a browser. Expected: dark terminal background, amber-accented radar sweep animating above the form, IBM Plex Mono wordmark, IBM Plex Sans body text/labels, form inputs with amber focus rings. This is the first real visual surface for the design system from Task 1 — confirm it actually looks like the design spec before moving on, not just that it compiles. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/ src/app/signup/
git commit -m "feat: add login and signup pages"
```

---

### Task 4: Protected layout, discovery feed page, and live verification

**Files:**
- Create: `src/components/LogoutButton.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/page.tsx`
- Delete: `src/app/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (Plan 3a), `getDiscoveryFeed` (Task 2), `RadarSweep` (Task 1).
- Produces: the protected area at `/` — an auth-gated layout with a header (wordmark, user email, logout) wrapping the discovery feed page.

This task also performs this plan's live end-to-end verification.

- [ ] **Step 1: Delete the default root page**

```bash
git rm src/app/page.tsx
```

This is necessary before creating `src/app/(app)/page.tsx` — both would otherwise resolve to the same `/` route, which Next.js treats as a conflict (route groups' parentheses don't appear in the URL).

- [ ] **Step 2: Create the logout button**

```typescript
// src/components/LogoutButton.tsx
"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className="text-ink/70 hover:text-amber">
      Log out
    </button>
  );
}
```

- [ ] **Step 3: Create the protected layout**

```typescript
// src/app/(app)/layout.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
        <span className="font-mono text-lg tracking-wide text-amber">ALPHARADAR</span>
        <div className="flex items-center gap-4 text-sm text-ink/70">
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create the discovery feed page**

```typescript
// src/app/(app)/page.tsx
import { getDiscoveryFeed } from "@/lib/db/discoveryFeed";
import { RadarSweep } from "@/components/RadarSweep";

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1m ago";
  return `${minutes}m ago`;
}

export default async function DiscoveryFeedPage() {
  const feed = await getDiscoveryFeed();

  if (feed.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <RadarSweep size={64} />
        <p className="text-ink/70">No tokens scored in the last 2 hours.</p>
        <p className="text-sm text-ink/40">The scanner runs on its own schedule — check back shortly.</p>
      </div>
    );
  }

  const maxScore = Math.max(1, ...feed.map((item) => item.totalScore));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-ink/50">
        <RadarSweep size={16} />
        <span>Last scanned {timeAgo(feed[0].capturedAt)}</span>
      </div>
      <table className="w-full border-collapse font-mono text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
            <th className="py-2 pr-4 font-normal">#</th>
            <th className="py-2 pr-4 font-normal">Token</th>
            <th className="py-2 pr-4 font-normal">Signal</th>
            <th className="py-2 pr-4 text-right font-normal">Price</th>
            <th className="py-2 pr-4 text-right font-normal">1h Vol</th>
            <th className="py-2 pr-4 text-right font-normal">Liquidity</th>
            <th className="py-2 text-right font-normal">Mkt Cap</th>
          </tr>
        </thead>
        <tbody>
          {feed.map((item, index) => (
            <tr key={item.tokenId} className="border-b border-ink/5">
              <td className="py-3 pr-4 text-ink/40">{index + 1}</td>
              <td className="py-3 pr-4">
                <div className="font-medium text-ink">{item.symbol}</div>
                <div className="text-xs text-ink/40">{item.name}</div>
              </td>
              <td className="py-3 pr-4">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full bg-amber"
                    style={{ width: `${Math.max(4, (item.totalScore / maxScore) * 100)}%` }}
                  />
                </div>
              </td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.priceUsd)}</td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.volume1hUsd)}</td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.liquidityUsd)}</td>
              <td className="py-3 text-right">{formatUsd(item.marketCapUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all pass, no regressions to any earlier plan's tests.

- [ ] **Step 6: Live end-to-end verification**

```bash
npm run dev
```

In a browser:

1. Visit `http://localhost:3000/` while logged out. Expected: redirected to `/login` — confirm the redirect actually happens, not just that `/login` looks right in isolation.
2. Sign up with a new email/password at `/signup`. Expected: redirected to `/`.
   - **If this lands you back on `/login` instead of the discovery feed**, that means Supabase's `signUp` didn't establish a usable session immediately in this configuration — per the design spec's noted fallback, change `signup/page.tsx`'s success redirect from `router.push("/")` to `router.push("/login")` and note this in your report as a real finding, not a bug you silently patched around.
3. Confirm the discovery feed renders — either real scored tokens (if the cron scan has run recently against real data) or the empty state (if not) — both are valid outcomes, but confirm whichever one you see matches what the code should produce given the actual state of `token_scores` in your local DB. If you see the empty state and want to confirm the populated view actually works, you may manually insert a fixture row or trigger a real scan tick (`POST /api/cron/scan` from Plan 1, if you have DexScreener connectivity) — your call based on what's fastest to verify with confidence.
4. Confirm the header shows your email and a working "Log out" link.
5. Click "Log out". Expected: redirected to `/login`, and visiting `/` again redirects back to `/login` (session actually cleared, not just a client-side redirect).
6. Log back in at `/login` with the same credentials. Expected: redirected to `/`, discovery feed renders again.

Take this as seriously as every prior plan's live verification — this is the only way to confirm the redirect chain, the session cookie handling, and the actual rendered design all work together, none of which any Vitest test in this plan covers.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add src/components/LogoutButton.tsx "src/app/(app)"
git commit -m "feat: add protected layout and discovery feed page"
```

---

## Self-Review Notes

- **Spec coverage:** Login, signup, protected redirect, the discovery feed (recency-windowed, latest-score-per-token, ranked), and the full visual design system (color tokens, type pairing, radar-sweep signature used both as ambient hero and functional freshness indicator) are all covered. Coin detail, watchlist, alerts page, settings, and feed filtering are explicitly out of scope per the design doc.
- **Known assumption flagged for live verification:** whether Supabase's `signUp` sets a usable session immediately (letting signup redirect straight to `/`) versus requiring a separate login step. Task 4's live verification step explicitly calls this out with a fallback instruction rather than silently assuming one behavior.
- **Route conflict handled explicitly:** Task 4 Step 1 deletes the pre-existing `src/app/page.tsx` before the route-group version is created — flagged as its own step so it isn't missed or done in the wrong order relative to Step 4.
- **Type consistency:** `DiscoveryFeedItem` is defined once (Task 2) and consumed as-is by Task 4's page — no redefinition.
