import { describe, expect, it } from 'vitest';
import { evaluatePositionAlerts } from './rules';
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

describe('evaluatePositionAlerts', () => {
  it('returns no alerts for a flat position with no history', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair(),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toEqual([]);
  });

  it('fires take_profit when price has doubled', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '2.00' }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('fires take_profit when market cap has doubled', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ marketCap: 2_000_000 }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('fires take_profit when volume is declining while price still rises', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 } }),
      score: makeScore({ volumeMomentum: -5 }),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('take_profit');
  });

  it('does not fire take_profit when nothing qualifies', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '1.10', marketCap: 1_100_000 }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).not.toContain('take_profit');
  });

  it('fires exit_warning when liquidity dropped 20% or more', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ liquidity: { usd: 40000, base: 1, quote: 1 } }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).toContain('exit_warning');
  });

  it('fires exit_warning when price is down 25% or more from the local high', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ priceUsd: '0.74' }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: 1.0,
    });
    expect(fired).toContain('exit_warning');
  });

  it('fires exit_warning when volume collapses', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair(),
      score: makeScore({ volumeMomentum: -18 }),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: null,
      localHighPrice: null,
    });
    expect(fired).toContain('exit_warning');
  });

  it('does not fire exit_warning when nothing qualifies', () => {
    const fired = evaluatePositionAlerts({
      pair: makePair({ liquidity: { usd: 48000, base: 1, quote: 1 } }),
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: 1.0,
    });
    expect(fired).not.toContain('exit_warning');
  });

  it('treats missing pair.liquidity as no liquidity signal, without crashing', () => {
    const pairWithoutLiquidity = makePair();
    delete (pairWithoutLiquidity as { liquidity?: unknown }).liquidity;
    const fired = evaluatePositionAlerts({
      pair: pairWithoutLiquidity,
      score: makeScore(),
      entryPrice: 1.0,
      entryMarketCap: 1_000_000,
      priorSnapshot: { liquidityUsd: 50000, priceUsd: 1.0, capturedAt: new Date().toISOString() },
      localHighPrice: null,
    });
    expect(fired).not.toContain('exit_warning');
  });
});
