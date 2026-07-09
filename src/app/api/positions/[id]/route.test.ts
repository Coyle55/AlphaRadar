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
