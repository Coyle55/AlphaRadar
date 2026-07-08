import { describe, expect, it } from 'vitest';
import { passesHardFilter, DEFAULT_FILTER_THRESHOLDS } from './filter';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  const now = Date.now();
  return {
    chainId: 'solana',
    pairAddress: 'pair-1',
    baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
    priceUsd: '0.001',
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
    pairCreatedAt: now - 10 * 60 * 1000,
    ...overrides,
  };
}

describe('passesHardFilter', () => {
  const now = new Date();

  it('passes a pair that clears all default thresholds', () => {
    expect(passesHardFilter(makePair(), now)).toBe(true);
  });

  it('rejects a pair younger than the minimum age', () => {
    const pair = makePair({ pairCreatedAt: now.getTime() - 1 * 60 * 1000 });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair below minimum liquidity', () => {
    const pair = makePair({ liquidity: { usd: 5000, base: 100, quote: 100 } });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair below minimum 1h volume', () => {
    const pair = makePair({ volume: { h24: 100000, h6: 30000, h1: 1000, m5: 100 } });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('respects custom thresholds', () => {
    const pair = makePair({ liquidity: { usd: 15000, base: 100, quote: 100 } });
    expect(passesHardFilter(pair, now, { minLiquidityUsd: 20000, minVolume1hUsd: 0, minAgeMinutes: 0 })).toBe(false);
    expect(passesHardFilter(pair, now, { minLiquidityUsd: 10000, minVolume1hUsd: 0, minAgeMinutes: 0 })).toBe(true);
  });

  it('rejects a pair with a missing marketCap and no fdv fallback', () => {
    const pair = makePair({ marketCap: undefined, fdv: undefined });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('rejects a pair with a non-finite marketCap and no fdv fallback', () => {
    const pair = makePair({ marketCap: NaN, fdv: undefined });
    expect(passesHardFilter(pair, now)).toBe(false);
  });

  it('passes when marketCap is missing but fdv is present', () => {
    const pair = makePair({ marketCap: undefined });
    expect(passesHardFilter(pair, now)).toBe(true);
  });

  it('passes when marketCap is non-finite but fdv is present', () => {
    const pair = makePair({ marketCap: NaN });
    expect(passesHardFilter(pair, now)).toBe(true);
  });
});
