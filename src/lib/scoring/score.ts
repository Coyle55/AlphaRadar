import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown, ScoreFactors } from '../db/tokens';
import { getEffectiveMarketCap } from '../scan/filter';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ScoreInput {
  pair: DexScreenerPair;
  initialLiquidityUsd: number;
}

export function scoreToken({ pair, initialLiquidityUsd }: ScoreInput): ScoreBreakdown {
  const marketCap = getEffectiveMarketCap(pair);
  if (!Number.isFinite(marketCap)) {
    throw new Error(
      `scoreToken called on a pair with no usable marketCap or fdv (${pair.pairAddress}) — this pair should have been rejected by passesHardFilter first`
    );
  }
  const marketCapValue = marketCap as number;

  const avgHourlyVolume6h = pair.volume.h6 / 6;
  const volumeMomentum =
    clamp(
      avgHourlyVolume6h > 0 ? (pair.volume.h1 - avgHourlyVolume6h) / avgHourlyVolume6h : 0,
      -1,
      1
    ) * 20;

  const liquidityGrowth =
    clamp(
      initialLiquidityUsd > 0 ? (pair.liquidity.usd - initialLiquidityUsd) / initialLiquidityUsd : 0,
      -1,
      1
    ) * 15;

  const priceStrength = clamp(pair.priceChange.h1 / 100, -1, 1) * 15;

  const totalTxns1h = pair.txns.h1.buys + pair.txns.h1.sells;
  const buySellRatio =
    totalTxns1h > 0 ? (pair.txns.h1.buys / totalTxns1h - 0.5) * 2 * 15 : 0;

  const marketCapBand = marketCapValue >= 50_000 && marketCapValue <= 5_000_000 ? 10 : -10;

  const liquidityLevel = pair.liquidity.usd >= 100_000 ? 15 : pair.liquidity.usd < 20_000 ? -20 : 0;

  const wickRejection = pair.priceChange.m5 <= -10 && pair.priceChange.h1 >= 0 ? -15 : 0;

  const factors: ScoreFactors = {
    volumeMomentum,
    liquidityGrowth,
    priceStrength,
    buySellRatio,
    marketCapBand,
    liquidityLevel,
    wickRejection,
  };

  const total = Object.values(factors).reduce((sum, value) => sum + value, 0);

  return { total, factors };
}
