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
