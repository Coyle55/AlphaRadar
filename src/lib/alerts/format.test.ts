import { describe, expect, it } from 'vitest';
import { formatAlertMessage } from './format';
import type { DexScreenerPair } from '../dexscreener/types';

function makePair(overrides: Partial<DexScreenerPair> = {}): DexScreenerPair {
  return {
    chainId: 'solana',
    pairAddress: 'pair-format-1',
    baseToken: { address: 'mint-format-1', name: 'Format Coin', symbol: 'FMT' },
    priceUsd: '0.0042',
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    liquidity: { usd: 123456, base: 1000, quote: 1000 },
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

describe('formatAlertMessage', () => {
  it('includes the alert label, symbol, name, price, liquidity, and a dexscreener link', () => {
    const message = formatAlertMessage('buy_watch', makePair());
    expect(message).toContain('Buy Watch');
    expect(message).toContain('FMT');
    expect(message).toContain('Format Coin');
    expect(message).toContain('$0.0042');
    expect(message).toContain('123,456');
    expect(message).toContain('https://dexscreener.com/solana/pair-format-1');
  });

  it('uses the correct label for each alert type', () => {
    expect(formatAlertMessage('volume_spike', makePair())).toContain('Volume Spike');
    expect(formatAlertMessage('liquidity_danger', makePair())).toContain('Liquidity Danger');
    expect(formatAlertMessage('trend_break', makePair())).toContain('Trend Break');
  });

  it('escapes Markdown special characters in token symbol and name', () => {
    const message = formatAlertMessage(
      'buy_watch',
      makePair({
        baseToken: {
          address: 'mint-format-1',
          symbol: 'DOGE_2.0',
          name: 'Doge*Killer[Bot]',
        },
      })
    );
    expect(message).toContain('DOGE\\_2.0');
    expect(message).toContain('Doge\\*Killer\\[Bot]');
    expect(message).not.toContain('DOGE_2.0');
    expect(message).not.toContain('Doge*Killer[');
  });

  it('escapes backticks in token name', () => {
    const message = formatAlertMessage(
      'buy_watch',
      makePair({
        baseToken: {
          address: 'mint-format-1',
          symbol: 'CODE`COIN',
          name: 'Code`Executor',
        },
      })
    );
    expect(message).toContain('CODE\\`COIN');
    expect(message).toContain('Code\\`Executor');
  });
});
