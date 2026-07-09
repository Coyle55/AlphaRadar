import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterAll(async () => {
  await closePool();
});

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/positions/some-id', { method: 'DELETE' });
}

describe('DELETE /api/positions/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: 'does-not-matter' }) });
    expect(response.status).toBe(401);
  });

  it('returns 404 when the position does not exist', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    const response = await DELETE(makeRequest(), {
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

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: position.id }) });
    expect(response.status).toBe(403);
  });

  it('closes the position when the owner requests it', async () => {
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

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: position.id }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });

    const rows = await getPool().query('select closed_at from positions where id = $1', [position.id]);
    expect(rows.rows[0].closed_at).not.toBeNull();
  });
});
