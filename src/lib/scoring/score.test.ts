import { describe, expect, it } from 'vitest';
import { scoreToken } from './score';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '0.001',
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

describe('scoreToken', () => {
  it('returns a neutral-ish score for a flat, average token', () => {
    const result = scoreToken({ pair: makePair(), initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBe(0);
    expect(result.factors.liquidityGrowth).toBe(0);
    expect(result.factors.priceStrength).toBe(0);
    expect(result.factors.buySellRatio).toBe(0);
    expect(result.factors.marketCapBand).toBe(10);
    expect(result.factors.liquidityLevel).toBe(0);
    expect(result.factors.wickRejection).toBe(0);
  });

  it('rewards volume running hotter than the 6h pace', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 6000, h1: 6000, m5: 500 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBeGreaterThan(0);
  });

  it('penalizes volume cooling off relative to the 6h pace', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 60000, h1: 1000, m5: 100 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.volumeMomentum).toBeLessThan(0);
  });

  it('rewards liquidity growth vs. initial liquidity', () => {
    const pair = makePair({ liquidity: { usd: 100000, base: 1000, quote: 1000 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.liquidityGrowth).toBeGreaterThan(0);
  });

  it('rewards positive 1h price change and penalizes negative', () => {
    const up = scoreToken({ pair: makePair({ priceChange: { m5: 0, h1: 20, h6: 0, h24: 0 } }), initialLiquidityUsd: 50000 });
    const down = scoreToken({ pair: makePair({ priceChange: { m5: 0, h1: -20, h6: 0, h24: 0 } }), initialLiquidityUsd: 50000 });
    expect(up.factors.priceStrength).toBeGreaterThan(0);
    expect(down.factors.priceStrength).toBeLessThan(0);
  });

  it('rewards a buy-heavy ratio and penalizes a sell-heavy ratio', () => {
    const buyHeavy = scoreToken({
      pair: makePair({ txns: { m5: { buys: 5, sells: 1 }, h1: { buys: 90, sells: 10 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } } }),
      initialLiquidityUsd: 50000,
    });
    const sellHeavy = scoreToken({
      pair: makePair({ txns: { m5: { buys: 1, sells: 5 }, h1: { buys: 10, sells: 90 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } } }),
      initialLiquidityUsd: 50000,
    });
    expect(buyHeavy.factors.buySellRatio).toBeGreaterThan(0);
    expect(sellHeavy.factors.buySellRatio).toBeLessThan(0);
  });

  it('penalizes market cap outside the $50k-$5M target band', () => {
    const tooSmall = scoreToken({ pair: makePair({ marketCap: 10000 }), initialLiquidityUsd: 50000 });
    const tooBig = scoreToken({ pair: makePair({ marketCap: 20_000_000 }), initialLiquidityUsd: 50000 });
    expect(tooSmall.factors.marketCapBand).toBe(-10);
    expect(tooBig.factors.marketCapBand).toBe(-10);
  });

  it('rewards liquidity at or above $100k and penalizes below $20k', () => {
    const high = scoreToken({ pair: makePair({ liquidity: { usd: 150000, base: 1, quote: 1 } }), initialLiquidityUsd: 50000 });
    const low = scoreToken({ pair: makePair({ liquidity: { usd: 5000, base: 1, quote: 1 } }), initialLiquidityUsd: 50000 });
    expect(high.factors.liquidityLevel).toBe(15);
    expect(low.factors.liquidityLevel).toBe(-20);
  });

  it('flags a sharp 5m rejection within an otherwise-up hour', () => {
    const pair = makePair({ priceChange: { m5: -15, h1: 5, h6: 0, h24: 0 } });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.wickRejection).toBe(-15);
  });

  it('sums all factors into the total', () => {
    const pair = makePair();
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    const sum = Object.values(result.factors).reduce((a, b) => a + b, 0);
    expect(result.total).toBe(sum);
  });

  it('throws if both marketCap and fdv are missing (should never happen post-filter, but guards the invariant)', () => {
    const pair = makePair({ marketCap: undefined, fdv: undefined });
    expect(() => scoreToken({ pair, initialLiquidityUsd: 50000 })).toThrow(/no usable marketCap or fdv/);
  });

  it('computes marketCapBand from fdv when marketCap is missing', () => {
    const pair = makePair({ marketCap: undefined, fdv: 1_000_000 });
    const result = scoreToken({ pair, initialLiquidityUsd: 50000 });
    expect(result.factors.marketCapBand).toBe(10);
  });
});
