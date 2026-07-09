import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken } from './tokens';
import { createTestUser } from '../testing/testUser';
import { closePosition, getOpenPositions, getPositionById, insertPosition } from './positions';

beforeEach(async () => {
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('insertPosition and getPositionById', () => {
  it('creates a position and reads it back', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-1',
      pairAddress: 'pair-pos-1',
      symbol: 'POS1',
      name: 'Position Coin 1',
      initialLiquidityUsd: 50000,
    });

    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
      amount: 500,
    });

    expect(position.userId).toBe(user.id);
    expect(position.tokenId).toBe(token.id);
    expect(position.entryPrice).toBe(0.001);
    expect(position.entryMarketCap).toBe(1_000_000);
    expect(position.amount).toBe(500);
    expect(position.closedAt).toBeNull();

    const fetched = await getPositionById(position.id);
    expect(fetched).toEqual(position);
  });

  it('allows amount to be omitted', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-2',
      pairAddress: 'pair-pos-2',
      symbol: 'POS2',
      name: 'Position Coin 2',
      initialLiquidityUsd: 50000,
    });

    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });

    expect(position.amount).toBeNull();
  });

  it('returns null for a position that does not exist', async () => {
    const fetched = await getPositionById('00000000-0000-0000-0000-000000000000');
    expect(fetched).toBeNull();
  });
});

describe('closePosition', () => {
  it('sets closedAt', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-pos-3',
      pairAddress: 'pair-pos-3',
      symbol: 'POS3',
      name: 'Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });

    await closePosition(position.id);

    const fetched = await getPositionById(position.id);
    expect(fetched?.closedAt).not.toBeNull();
  });
});

describe('getOpenPositions', () => {
  it('returns only open positions, joined with token mint/pair address and initial liquidity', async () => {
    const user = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-pos-4',
      pairAddress: 'pair-pos-4',
      symbol: 'POS4',
      name: 'Position Coin 4',
      initialLiquidityUsd: 42000,
    });
    const closedToken = await upsertToken({
      mintAddress: 'mint-pos-5',
      pairAddress: 'pair-pos-5',
      symbol: 'POS5',
      name: 'Position Coin 5',
      initialLiquidityUsd: 50000,
    });

    const openPosition = await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const closedPositionRecord = await insertPosition({
      userId: user.id,
      tokenId: closedToken.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });
    await closePosition(closedPositionRecord.id);

    const open = await getOpenPositions();

    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(openPosition.id);
    expect(open[0].mintAddress).toBe('mint-pos-4');
    expect(open[0].pairAddress).toBe('pair-pos-4');
    expect(open[0].initialLiquidityUsd).toBe(42000);
  });
});
