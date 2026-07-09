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
    expect(feed[0].mintAddress).toBe('mint-feed-high');
    expect(feed[1].mintAddress).toBe('mint-feed-low');
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
