import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestTokenProfiles, fetchTokenPairs } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLatestTokenProfiles', () => {
  it('filters profiles to chainId solana', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { chainId: 'solana', tokenAddress: 'sol-mint-1' },
        { chainId: 'ethereum', tokenAddress: 'eth-mint-1' },
        { chainId: 'solana', tokenAddress: 'sol-mint-2' },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const profiles = await fetchLatestTokenProfiles();

    expect(profiles).toEqual([
      { chainId: 'solana', tokenAddress: 'sol-mint-1' },
      { chainId: 'solana', tokenAddress: 'sol-mint-2' },
    ]);
    expect(mockFetch).toHaveBeenCalledWith('https://api.dexscreener.com/token-profiles/latest/v1');
  });

  it('throws if the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchLatestTokenProfiles()).rejects.toThrow('DexScreener request failed: 500');
  });
});

describe('fetchTokenPairs', () => {
  it('fetches pairs for a Solana token address', async () => {
    const fakePair = { chainId: 'solana', pairAddress: 'pair-abc' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [fakePair],
    });
    vi.stubGlobal('fetch', mockFetch);

    const pairs = await fetchTokenPairs('sol-mint-1');

    expect(pairs).toEqual([fakePair]);
    expect(mockFetch).toHaveBeenCalledWith('https://api.dexscreener.com/token-pairs/v1/solana/sol-mint-1');
  });

  it('returns an empty array when the response has no pairs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));

    const pairs = await fetchTokenPairs('sol-mint-2');

    expect(pairs).toEqual([]);
  });
});
