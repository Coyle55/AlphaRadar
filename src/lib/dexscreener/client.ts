import type { DexScreenerPair, DexScreenerTokenProfile } from './types';

const BASE_URL = 'https://api.dexscreener.com';

export async function fetchLatestTokenProfiles(): Promise<DexScreenerTokenProfile[]> {
  const response = await fetch(`${BASE_URL}/token-profiles/latest/v1`);
  if (!response.ok) {
    throw new Error(`DexScreener request failed: ${response.status}`);
  }
  const profiles = (await response.json()) as DexScreenerTokenProfile[];
  return profiles.filter((profile) => profile.chainId === 'solana');
}

export async function fetchTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  const response = await fetch(`${BASE_URL}/token-pairs/v1/solana/${tokenAddress}`);
  if (!response.ok) {
    throw new Error(`DexScreener request failed: ${response.status}`);
  }
  const pairs = (await response.json()) as DexScreenerPair[] | null;
  return pairs ?? [];
}
