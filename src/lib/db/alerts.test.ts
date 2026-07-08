import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { upsertToken } from './tokens';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';
import { wasRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from './alerts';

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
  await getPool().query('truncate table alerts, token_scores, token_snapshots, tokens cascade');
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
