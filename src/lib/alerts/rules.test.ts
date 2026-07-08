import { describe, expect, it } from 'vitest';
import { evaluateDiscoveryAlerts } from './rules';
import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '1.00',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 50000, base: 1000, quote: 1000 },
    volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
    txns: {
      m5: { buys: 5, sells: 5 },
      h1: { buys: 50, sells: 50 },
      h6: { buys: 200, sells: 200 },
      h24: { buys: 500, sells: 500 },
    },
    marketCap: 1_000_000,
    fdv: 1_000_000,
    pairCreatedAt: Date.now() - 60 * 60 * 1000,
    ...overrides,
  };
}

function makeScore(overrides: Partial<ScoreBreakdown['factors']> = {}): ScoreBreakdown {
  const factors = {
    volumeMomentum: 0,
    liquidityGrowth: 0,
    priceStrength: 0,
    buySellRatio: 0,
    marketCapBand: 0,
    liquidityLevel: 0,
    wickRejection: 0,
    ...overrides,
  };
  const total = Object.values(factors).reduce((a, b) => a + b, 0);
  return { total, factors };
}

describe('evaluateDiscoveryAlerts', () => {
  it('returns no alerts for a flat, unremarkable token with no history', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore(),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toEqual([]);
  });

  it('fires buy_watch when all buy-watch conditions are met', () => {
    const pair = makePair({
      marketCap: 2_000_000,
      liquidity: { usd: 150000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).toContain('buy_watch');
  });

  it('does not fire buy_watch when market cap is above the threshold', () => {
    const pair = makePair({
      marketCap: 10_000_000,
      liquidity: { usd: 150000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).not.toContain('buy_watch');
  });

  it('fires volume_spike when volumeMomentum meets the threshold', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: 18 }),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('volume_spike');
  });

  it('does not fire volume_spike when volumeMomentum is below the threshold', () => {
    const fired = evaluateDiscoveryAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: 10 }),
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).not.toContain('volume_spike');
  });

  it('fires liquidity_danger when liquidity dropped 20% or more since the prior snapshot', () => {
    const pair = makePair({ liquidity: { usd: 40000, base: 1, quote: 1 } });
    const fired = evaluateDiscoveryAlerts({
      pair,
      score: makeScore(),
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('liquidity_danger');
  });

  it('does not fire liquidity_danger with no prior snapshot', () => {
    const pair = makePair({ liquidity: { usd: 100, base: 1, quote: 1 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: null });
    expect(fired).not.toContain('liquidity_danger');
  });

  it('fires trend_break when price is down 10% or more from the local high and h1 change is negative', () => {
    const pair = makePair({ priceUsd: '0.89', priceChange: { m5: 0, h1: -5, h6: 0, h24: 0 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: 1.0 });
    expect(fired).toContain('trend_break');
  });

  it('does not fire trend_break when h1 change is positive despite the price drop from high', () => {
    const pair = makePair({ priceUsd: '0.89', priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 } });
    const fired = evaluateDiscoveryAlerts({ pair, score: makeScore(), priorSnapshot: null, localHighPrice: 1.0 });
    expect(fired).not.toContain('trend_break');
  });

  it('can fire multiple alert types in the same evaluation', () => {
    const pair = makePair({
      marketCap: 2_000_000,
      liquidity: { usd: 100000, base: 1, quote: 1 },
      volume: { h24: 500000, h6: 300000, h1: 300000, m5: 10000 },
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      txns: {
        m5: { buys: 5, sells: 1 },
        h1: { buys: 60, sells: 20 },
        h6: { buys: 0, sells: 0 },
        h24: { buys: 0, sells: 0 },
      },
    });
    const fired = evaluateDiscoveryAlerts({
      pair,
      score: makeScore({ volumeMomentum: 18 }),
      priorSnapshot: { liquidityUsd: 125000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('buy_watch');
    expect(fired).toContain('volume_spike');
    expect(fired).toContain('liquidity_danger');
  });
});
