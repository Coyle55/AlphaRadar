import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { insertSnapshot, upsertToken } from './tokens';
import { createTestUser } from '../testing/testUser';
import {
  closePosition,
  getClosedPositionsForUser,
  getOpenPositions,
  getOpenPositionsForUser,
  getPositionById,
  insertPosition,
} from './positions';

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
  it('sets closedAt, exitPrice, and exitMarketCap', async () => {
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

    await closePosition(position.id, 0.0015, 1_500_000);

    const fetched = await getPositionById(position.id);
    expect(fetched?.closedAt).not.toBeNull();
    expect(fetched?.exitPrice).toBe(0.0015);
    expect(fetched?.exitMarketCap).toBe(1_500_000);
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
    await closePosition(closedPositionRecord.id, 0.003, 3_000_000);

    const open = await getOpenPositions();

    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(openPosition.id);
    expect(open[0].mintAddress).toBe('mint-pos-4');
    expect(open[0].pairAddress).toBe('pair-pos-4');
    expect(open[0].initialLiquidityUsd).toBe(42000);
  });
});

describe('getOpenPositionsForUser', () => {
  it('returns an empty array for a user with no positions', async () => {
    const user = await createTestUser();
    const positions = await getOpenPositionsForUser(user.id);
    expect(positions).toEqual([]);
  });

  it('includes current price from the latest snapshot when one exists', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-1',
      pairAddress: 'pair-watch-1',
      symbol: 'WATCH1',
      name: 'Watch Coin 1',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
      amount: 500,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.0015,
      liquidityUsd: 60000,
      volume1hUsd: 5000,
      volume24hUsd: 20000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 1_500_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('WATCH1');
    expect(positions[0].currentPriceUsd).toBe(0.0015);
    expect(positions[0].amount).toBe(500);
  });

  it('returns null current price when the token has never been scanned', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-2',
      pairAddress: 'pair-watch-2',
      symbol: 'WATCH2',
      name: 'Watch Coin 2',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.002,
      entryMarketCap: 2_000_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].currentPriceUsd).toBeNull();
    expect(positions[0].currentPriceCapturedAt).toBeNull();
  });

  it('excludes closed positions and positions belonging to other users', async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-watch-3',
      pairAddress: 'pair-watch-3',
      symbol: 'WATCH3',
      name: 'Watch Coin 3',
      initialLiquidityUsd: 50000,
    });
    const closedToken = await upsertToken({
      mintAddress: 'mint-watch-4',
      pairAddress: 'pair-watch-4',
      symbol: 'WATCH4',
      name: 'Watch Coin 4',
      initialLiquidityUsd: 50000,
    });
    const otherToken = await upsertToken({
      mintAddress: 'mint-watch-5',
      pairAddress: 'pair-watch-5',
      symbol: 'WATCH5',
      name: 'Watch Coin 5',
      initialLiquidityUsd: 50000,
    });

    const open = await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const closed = await insertPosition({
      userId: user.id,
      tokenId: closedToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(closed.id, 0.002, 2_000_000);
    await insertPosition({
      userId: otherUser.id,
      tokenId: otherToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });

    const positions = await getOpenPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].id).toBe(open.id);
  });
});

describe('getClosedPositionsForUser', () => {
  it('returns an empty array for a user with no closed positions', async () => {
    const user = await createTestUser();
    const positions = await getClosedPositionsForUser(user.id);
    expect(positions).toEqual([]);
  });

  it('returns realized entry/exit prices for a closed position', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-watch-6',
      pairAddress: 'pair-watch-6',
      symbol: 'WATCH6',
      name: 'Watch Coin 6',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(position.id, 0.0025, 2_500_000);

    const positions = await getClosedPositionsForUser(user.id);

    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('WATCH6');
    expect(positions[0].entryPrice).toBe(0.001);
    expect(positions[0].exitPrice).toBe(0.0025);
  });

  it('excludes open positions and positions belonging to other users', async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const openToken = await upsertToken({
      mintAddress: 'mint-watch-7',
      pairAddress: 'pair-watch-7',
      symbol: 'WATCH7',
      name: 'Watch Coin 7',
      initialLiquidityUsd: 50000,
    });
    const otherToken = await upsertToken({
      mintAddress: 'mint-watch-8',
      pairAddress: 'pair-watch-8',
      symbol: 'WATCH8',
      name: 'Watch Coin 8',
      initialLiquidityUsd: 50000,
    });

    await insertPosition({
      userId: user.id,
      tokenId: openToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    const otherPosition = await insertPosition({
      userId: otherUser.id,
      tokenId: otherToken.id,
      entryPrice: 0.001,
      entryMarketCap: 1_000_000,
    });
    await closePosition(otherPosition.id, 0.002, 2_000_000);

    const positions = await getClosedPositionsForUser(user.id);

    expect(positions).toEqual([]);
  });
});
