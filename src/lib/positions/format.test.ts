import { describe, expect, it } from 'vitest';
import { formatPositionAlertMessage } from './format';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-pos-format',
    baseToken: { address: 'mint-pos-format', name: 'Position Format Coin', symbol: 'PFMT' },
    priceUsd: '2.00',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 100000, base: 1000, quote: 1000 },
    volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
    txns: {
      m5: { buys: 5, sells: 5 },
      h1: { buys: 50, sells: 50 },
      h6: { buys: 200, sells: 200 },
      h24: { buys: 500, sells: 500 },
    },
    marketCap: 2_000_000,
    fdv: 2_000_000,
    pairCreatedAt: Date.now() - 60 * 60 * 1000,
    ...overrides,
  };
}

describe('formatPositionAlertMessage', () => {
  it('includes the label, symbol, entry price, current price with percent change, and a dexscreener link', () => {
    const message = formatPositionAlertMessage('take_profit', makePair(), 1.0);
    expect(message).toContain('Take Profit');
    expect(message).toContain('PFMT');
    expect(message).toContain('Entry: $1');
    expect(message).toContain('$2.00');
    expect(message).toContain('+100.0%');
    expect(message).toContain('https://dexscreener.com/solana/pair-pos-format');
  });

  it('shows a negative percent change when price is down from entry', () => {
    const message = formatPositionAlertMessage('exit_warning', makePair({ priceUsd: '0.50' }), 1.0);
    expect(message).toContain('Exit Warning');
    expect(message).toContain('-50.0%');
  });
});
