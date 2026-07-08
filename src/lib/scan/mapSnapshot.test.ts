import { describe, expect, it } from 'vitest';
import { mapPairToSnapshot } from './mapSnapshot';
import type { DexScreenerPair } from '../dexscreener/types';

describe('mapPairToSnapshot', () => {
  it('maps a DexScreenerPair to a snapshot input', () => {
    const pair: DexScreenerPair = {
      chainId: 'solana',
      pairAddress: 'pair-1',
      baseToken: { address: 'mint-1', name: 'Test', symbol: 'TST' },
      priceUsd: '0.0015',
      priceChange: { m5: 1, h1: 5, h6: 10, h24: 20 },
      liquidity: { usd: 42000, base: 1000, quote: 1000 },
      volume: { h24: 200000, h6: 60000, h1: 15000, m5: 2000 },
      txns: {
        m5: { buys: 6, sells: 2 },
        h1: { buys: 60, sells: 25 },
        h6: { buys: 250, sells: 100 },
        h24: { buys: 600, sells: 350 },
      },
      marketCap: 900000,
      fdv: 950000,
      pairCreatedAt: Date.now() - 30 * 60 * 1000,
    };

    expect(mapPairToSnapshot(pair)).toEqual({
      priceUsd: 0.0015,
      liquidityUsd: 42000,
      volume1hUsd: 15000,
      volume24hUsd: 200000,
      buys1h: 60,
      sells1h: 25,
      marketCapUsd: 900000,
    });
  });

  it('throws if marketCap is missing (should never happen post-filter, but guards the invariant)', () => {
    const pair: DexScreenerPair = {
      chainId: 'solana',
      pairAddress: 'pair-2',
      baseToken: { address: 'mint-2', name: 'Test', symbol: 'TST' },
      priceUsd: '0.0015',
      priceChange: { m5: 1, h1: 5, h6: 10, h24: 20 },
      liquidity: { usd: 42000, base: 1000, quote: 1000 },
      volume: { h24: 200000, h6: 60000, h1: 15000, m5: 2000 },
      txns: {
        m5: { buys: 6, sells: 2 },
        h1: { buys: 60, sells: 25 },
        h6: { buys: 250, sells: 100 },
        h24: { buys: 600, sells: 350 },
      },
      marketCap: undefined,
      fdv: 950000,
      pairCreatedAt: Date.now() - 30 * 60 * 1000,
    };

    expect(() => mapPairToSnapshot(pair)).toThrow(/non-finite marketCap/);
  });
});
