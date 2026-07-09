import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken } from './tokens';
import { insertPosition } from './positions';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';
import {
  wasRecentlyAlerted,
  insertAlert,
  markTelegramResult,
  ALERT_COOLDOWN_MINUTES,
  wasPositionRecentlyAlerted,
  getDiscoveryAlerts,
  getPositionAlertsForUser,
} from './alerts';
import { createTestUser } from '../testing/testUser';

const fakeScore: ScoreBreakdown = {
  total: 10,
  factors: {
    volumeMomentum: 5,
    liquidityGrowth: 0,
    priceStrength: 0,
    buySellRatio: 0,
    marketCapBand: 5,
    liquidityLevel: 0,
    wickRejection: 0,
  },
};

const fakePair: DexScreenerPair = {
  chainId: 'solana',
  pairAddress: 'pair-alert-1',
  baseToken: { address: 'mint-alert-1', name: 'Alert Coin', symbol: 'ALRT' },
  priceUsd: '0.01',
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
  liquidity: { usd: 50000, base: 1000, quote: 1000 },
  volume: { h24: 100000, h6: 30000, h1: 10000, m5: 1000 },
  txns: {
    m5: { buys: 5, sells: 2 },
    h1: { buys: 50, sells: 20 },
    h6: { buys: 200, sells: 100 },
    h24: { buys: 500, sells: 300 },
  },
  marketCap: 1_000_000,
  fdv: 1_000_000,
  pairCreatedAt: Date.now() - 60 * 60 * 1000,
};

beforeEach(async () => {
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterAll(async () => {
  await closePool();
});

describe('insertAlert and wasRecentlyAlerted', () => {
  it('inserts an alert and finds it within the cooldown window', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-1',
      pairAddress: 'pair-alert-1',
      symbol: 'ALRT',
      name: 'Alert Coin',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });

    expect(alert.alertType).toBe('buy_watch');
    expect(alert.telegramSent).toBe(false);
    expect(alert.telegramError).toBeNull();

    const recent = await wasRecentlyAlerted(token.id, 'buy_watch', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(true);
  });

  it('does not report a cooldown hit for a different alert type on the same token', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-2',
      pairAddress: 'pair-alert-2',
      symbol: 'ALRT2',
      name: 'Alert Coin 2',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });

    const recent = await wasRecentlyAlerted(token.id, 'volume_spike', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(false);
  });

  it('does not report a cooldown hit once the cooldown window is 0 minutes', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-3',
      pairAddress: 'pair-alert-3',
      symbol: 'ALRT3',
      name: 'Alert Coin 3',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({ tokenId: token.id, alertType: 'trend_break', payload: { score: fakeScore, pair: fakePair } });

    const recent = await wasRecentlyAlerted(token.id, 'trend_break', 0);
    expect(recent).toBe(false);
  });

  it('returns triggeredAt as an ISO string, not a Date object', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-5',
      pairAddress: 'pair-alert-5',
      symbol: 'ALRT5',
      name: 'Alert Coin 5',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });

    expect(typeof alert.triggeredAt).toBe('string');
    expect(() => new Date(alert.triggeredAt).toISOString()).not.toThrow();
  });
});

describe('markTelegramResult', () => {
  it('updates telegram_sent and telegram_error', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-4',
      pairAddress: 'pair-alert-4',
      symbol: 'ALRT4',
      name: 'Alert Coin 4',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'liquidity_danger',
      payload: { score: fakeScore, pair: fakePair },
    });
    await markTelegramResult(alert.id, false, 'Telegram sendMessage failed: 500 boom');

    const result = await getPool().query('select telegram_sent, telegram_error from alerts where id = $1', [alert.id]);
    expect(result.rows[0].telegram_sent).toBe(false);
    expect(result.rows[0].telegram_error).toBe('Telegram sendMessage failed: 500 boom');
  });
});

describe('insertAlert with userId and positionId', () => {
  it('stores and returns userId and positionId when provided', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-1',
      pairAddress: 'pair-alert-pos-1',
      symbol: 'ALRTP1',
      name: 'Alert Position Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    expect(alert.userId).toBe(user.id);
    expect(alert.positionId).toBe(position.id);
  });

  it('leaves userId and positionId null when omitted (discovery alerts)', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-2',
      pairAddress: 'pair-alert-pos-2',
      symbol: 'ALRTP2',
      name: 'Alert Position Coin 2',
      initialLiquidityUsd: 50000,
    });

    const alert = await insertAlert({
      tokenId: token.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });

    expect(alert.userId).toBeNull();
    expect(alert.positionId).toBeNull();
  });
});

describe('wasPositionRecentlyAlerted', () => {
  it('finds an alert within the cooldown window for the same position and type', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-3',
      pairAddress: 'pair-alert-pos-3',
      symbol: 'ALRTP3',
      name: 'Alert Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'exit_warning',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    const recent = await wasPositionRecentlyAlerted(position.id, 'exit_warning', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(true);
  });

  it('does not find a cooldown hit for a different position on the same token', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-alert-pos-4',
      pairAddress: 'pair-alert-pos-4',
      symbol: 'ALRTP4',
      name: 'Alert Position Coin 4',
      initialLiquidityUsd: 50000,
    });
    const positionA = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });
    const positionB = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 2,
      entryMarketCap: 2_000_000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: positionA.id,
    });

    const recent = await wasPositionRecentlyAlerted(positionB.id, 'take_profit', ALERT_COOLDOWN_MINUTES);
    expect(recent).toBe(false);
  });
});

describe('getDiscoveryAlerts', () => {
  it('returns only alerts with no user_id, most recent first', async () => {
    const user = await createTestUser();
    const discoveryToken = await upsertToken({
      mintAddress: 'mint-feed-discovery-1',
      pairAddress: 'pair-feed-discovery-1',
      symbol: 'DISC1',
      name: 'Discovery Coin 1',
      initialLiquidityUsd: 50000,
    });
    const positionToken = await upsertToken({
      mintAddress: 'mint-feed-position-1',
      pairAddress: 'pair-feed-position-1',
      symbol: 'POSF1',
      name: 'Position Feed Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: positionToken.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    await insertAlert({
      tokenId: discoveryToken.id,
      alertType: 'buy_watch',
      payload: { score: fakeScore, pair: fakePair },
    });
    await insertAlert({
      tokenId: positionToken.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(1);
    expect(feed[0].symbol).toBe('DISC1');
    expect(feed[0].alertType).toBe('buy_watch');
  });

  it('reads price and liquidity from the stored payload snapshot', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-feed-discovery-2',
      pairAddress: 'pair-feed-discovery-2',
      symbol: 'DISC2',
      name: 'Discovery Coin 2',
      initialLiquidityUsd: 50000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'volume_spike',
      payload: {
        score: fakeScore,
        pair: { ...fakePair, priceUsd: '0.0042', liquidity: { usd: 77777, base: 1, quote: 1 } },
      },
    });

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(1);
    expect(feed[0].priceUsd).toBe(0.0042);
    expect(feed[0].liquidityUsd).toBe(77777);
  });

  it('caps results at 50', async () => {
    const token = await upsertToken({
      mintAddress: 'mint-feed-discovery-cap',
      pairAddress: 'pair-feed-discovery-cap',
      symbol: 'CAP',
      name: 'Cap Coin',
      initialLiquidityUsd: 50000,
    });

    for (let i = 0; i < 55; i++) {
      await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });
    }

    const feed = await getDiscoveryAlerts();

    expect(feed).toHaveLength(50);
  });
});

describe('getPositionAlertsForUser', () => {
  it("returns only the requesting user's alerts, excluding discovery alerts and other users' alerts", async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-feed-position-2',
      pairAddress: 'pair-feed-position-2',
      symbol: 'POSF2',
      name: 'Position Feed Coin 2',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });
    const otherPosition = await insertPosition({
      userId: otherUser.id,
      tokenId: token.id,
      entryPrice: 1,
      entryMarketCap: 1_000_000,
    });

    await insertAlert({
      tokenId: token.id,
      alertType: 'exit_warning',
      payload: { score: fakeScore, pair: fakePair },
      userId: user.id,
      positionId: position.id,
    });
    await insertAlert({
      tokenId: token.id,
      alertType: 'take_profit',
      payload: { score: fakeScore, pair: fakePair },
      userId: otherUser.id,
      positionId: otherPosition.id,
    });
    await insertAlert({ tokenId: token.id, alertType: 'buy_watch', payload: { score: fakeScore, pair: fakePair } });

    const feed = await getPositionAlertsForUser(user.id);

    expect(feed).toHaveLength(1);
    expect(feed[0].alertType).toBe('exit_warning');
  });

  it('returns an empty array for a user with no position alerts', async () => {
    const user = await createTestUser();
    const feed = await getPositionAlertsForUser(user.id);
    expect(feed).toEqual([]);
  });
});
