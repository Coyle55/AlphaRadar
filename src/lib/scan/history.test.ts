import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../db/pool';
import { upsertToken, insertSnapshot } from '../db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from './history';

beforeEach(async () => {
  await getPool().query('truncate table token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('getPriorSnapshot', () => {
  it('returns null when there is only one snapshot', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-1',
      pairAddress: 'pair-hist-1',
      symbol: 'HIST1',
      name: 'History Coin 1',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });

    const prior = await getPriorSnapshot(token.id);
    expect(prior).toBeNull();
  });

  it('returns the second-most-recent snapshot when at least two exist', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-2',
      pairAddress: 'pair-hist-2',
      symbol: 'HIST2',
      name: 'History Coin 2',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.02,
      liquidityUsd: 20000,
      volume1hUsd: 2000,
      volume24hUsd: 6000,
      buys1h: 20,
      sells1h: 10,
      marketCapUsd: 200000,
    });

    const prior = await getPriorSnapshot(token.id);
    expect(prior).not.toBeNull();
    expect(prior?.liquidityUsd).toBe(10000);
    expect(prior?.priceUsd).toBe(0.01);
  });
});

describe('getLocalHighPrice', () => {
  it('returns null when there are no snapshots', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-3',
      pairAddress: 'pair-hist-3',
      symbol: 'HIST3',
      name: 'History Coin 3',
      initialLiquidityUsd: 10000,
    });
    const high = await getLocalHighPrice(token.id);
    expect(high).toBeNull();
  });

  it('returns the maximum price_usd across all snapshots', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-hist-4',
      pairAddress: 'pair-hist-4',
      symbol: 'HIST4',
      name: 'History Coin 4',
      initialLiquidityUsd: 10000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.05,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });
    await insertSnapshot(token.id, {
      priceUsd: 0.03,
      liquidityUsd: 10000,
      volume1hUsd: 1000,
      volume24hUsd: 5000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 100000,
    });

    const high = await getLocalHighPrice(token.id);
    expect(high).toBe(0.05);
  });
});
