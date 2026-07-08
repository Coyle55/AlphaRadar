import { beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { POST } from './route';

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
      if (url.includes('token-profiles')) {
        return {
          ok: true,
          json: async () => [{ chainId: 'solana', tokenAddress: 'mint-target' }],
        };
      }
      if (url.includes('mint-target')) {
        // lower-liquidity, non-matching pair listed first; higher-liquidity, matching pair second
        return { ok: true, json: async () => [wrongTokenPair, matchingPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 1, skipped: 0, total: 1 });

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
    expect(body).toEqual({ scored: 0, skipped: 1, total: 1 });
  });
});
