import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken, insertSnapshot, insertScore } from './tokens';

beforeEach(async () => {
  await getPool().query('truncate table token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('upsertToken', () => {
  it('creates a new token and returns its record', async () => {
    const token = await upsertToken({
      mintAddress: 'mint123',
      pairAddress: 'pair123',
      symbol: 'FOO',
      name: 'Foo Coin',
      initialLiquidityUsd: 50000,
    });

    expect(token.mintAddress).toBe('mint123');
    expect(token.initialLiquidityUsd).toBe(50000);
    expect(token.id).toBeTruthy();
  });

  it('does not overwrite initialLiquidityUsd on a repeat upsert', async () => {
    await upsertToken({
      mintAddress: 'mint456',
      pairAddress: 'pair456',
      symbol: 'BAR',
      name: 'Bar Coin',
      initialLiquidityUsd: 10000,
    });

    const second = await upsertToken({
      mintAddress: 'mint456',
      pairAddress: 'pair456',
      symbol: 'BAR',
      name: 'Bar Coin',
      initialLiquidityUsd: 999999,
    });

    expect(second.initialLiquidityUsd).toBe(10000);
  });
});

describe('insertSnapshot and insertScore', () => {
  it('inserts a snapshot and a linked score', async () => {
    const token = await upsertToken({
      mintAddress: 'mint789',
      pairAddress: 'pair789',
      symbol: 'BAZ',
      name: 'Baz Coin',
      initialLiquidityUsd: 20000,
    });

    const snapshotId = await insertSnapshot(token.id, {
      priceUsd: 0.0012,
      liquidityUsd: 25000,
      volume1hUsd: 8000,
      volume24hUsd: 60000,
      buys1h: 40,
      sells1h: 20,
      marketCapUsd: 1_200_000,
    });

    expect(snapshotId).toBeTruthy();

    await insertScore(snapshotId, {
      total: 12.5,
      factors: {
        volumeMomentum: 5,
        liquidityGrowth: 2,
        priceStrength: 3,
        buySellRatio: 2.5,
        marketCapBand: 0,
        liquidityLevel: 0,
        wickRejection: 0,
      },
    });

    const result = await getPool().query('select * from token_scores where snapshot_id = $1', [snapshotId]);
    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0].total_score)).toBe(12.5);
  });
});
