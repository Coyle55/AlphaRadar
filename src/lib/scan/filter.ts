import type { DexScreenerPair } from '../dexscreener/types';

export interface FilterThresholds {
  minLiquidityUsd: number;
  minVolume1hUsd: number;
  minAgeMinutes: number;
}

export const DEFAULT_FILTER_THRESHOLDS: FilterThresholds = {
  minLiquidityUsd: 10_000,
  minVolume1hUsd: 5_000,
  minAgeMinutes: 5,
};

export function passesHardFilter(
  pair: DexScreenerPair,
  now: Date,
  thresholds: FilterThresholds = DEFAULT_FILTER_THRESHOLDS
): boolean {
  if (!Number.isFinite(pair.marketCap)) return false;
  const ageMinutes = (now.getTime() - pair.pairCreatedAt) / 60_000;
  if (ageMinutes < thresholds.minAgeMinutes) return false;
  if (pair.liquidity.usd < thresholds.minLiquidityUsd) return false;
  if (pair.volume.h1 < thresholds.minVolume1hUsd) return false;
  return true;
}
