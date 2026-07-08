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

  it('skips a token whose only pair has no liquidity field, without throwing', async () => {
    // Mirrors the real DexScreener API shape for very fresh pump.fun launches,
    // which omit the `liquidity` key entirely rather than sending a partial object.
    const noLiquidityPair = {
      chainId: 'solana',
      pairAddress: 'pair-no-liquidity',
      baseToken: { address: 'mint-no-liquidity', name: 'No Liquidity Coin', symbol: 'NOLIQ' },
      priceUsd: '0.002',
      priceChange: { m5: 0, h1: 10, h6: 5, h24: 20 },
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

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('token-profiles')) {
        return {
          ok: true,
          json: async () => [{ chainId: 'solana', tokenAddress: 'mint-no-liquidity' }],
        };
      }
      if (url.includes('mint-no-liquidity')) {
        return { ok: true, json: async () => [noLiquidityPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 0, skipped: 1, total: 1, alertsFired: 0 });

    const rows = await getPool().query('select * from tokens');
    expect(rows.rows).toHaveLength(0);
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
