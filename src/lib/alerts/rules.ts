import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';
import type { AlertType } from '../db/alerts';
import type { PriorSnapshot } from '../scan/history';
import { getEffectiveMarketCap } from '../scan/filter';

export interface AlertEvaluationInput {
  pair: DexScreenerPair;
  score: ScoreBreakdown;
  priorSnapshot: PriorSnapshot | null;
  localHighPrice: number | null;
}

const BUY_WATCH_MAX_MARKET_CAP = 5_000_000;
const BUY_WATCH_MIN_LIQUIDITY = 100_000;
const BUY_WATCH_MIN_VOLUME_1H = 250_000;
const VOLUME_SPIKE_THRESHOLD = 15;
const LIQUIDITY_DANGER_DROP_RATIO = 0.2;
const TREND_BREAK_DROP_RATIO = 0.1;

export function evaluateDiscoveryAlerts(input: AlertEvaluationInput): AlertType[] {
  const fired: AlertType[] = [];
  if (evaluatesBuyWatch(input.pair)) fired.push('buy_watch');
  if (evaluatesVolumeSpike(input.score)) fired.push('volume_spike');
  if (evaluatesLiquidityDanger(input.pair, input.priorSnapshot)) fired.push('liquidity_danger');
  if (evaluatesTrendBreak(input.pair, input.localHighPrice)) fired.push('trend_break');
  return fired;
}

function evaluatesBuyWatch(pair: DexScreenerPair): boolean {
  const marketCap = getEffectiveMarketCap(pair);
  if (marketCap === undefined) return false;
  return (
    marketCap < BUY_WATCH_MAX_MARKET_CAP &&
    (pair.liquidity?.usd ?? 0) >= BUY_WATCH_MIN_LIQUIDITY &&
    pair.volume.h1 >= BUY_WATCH_MIN_VOLUME_1H &&
    pair.priceChange.h1 > 0 &&
    pair.txns.h1.buys > pair.txns.h1.sells
  );
}

function evaluatesVolumeSpike(score: ScoreBreakdown): boolean {
  return score.factors.volumeMomentum >= VOLUME_SPIKE_THRESHOLD;
}

function evaluatesLiquidityDanger(pair: DexScreenerPair, prior: PriorSnapshot | null): boolean {
  if (!prior || prior.liquidityUsd <= 0 || !pair.liquidity) return false;
  const dropRatio = (prior.liquidityUsd - pair.liquidity.usd) / prior.liquidityUsd;
  return dropRatio >= LIQUIDITY_DANGER_DROP_RATIO;
}

function evaluatesTrendBreak(pair: DexScreenerPair, localHigh: number | null): boolean {
  if (!localHigh || localHigh <= 0) return false;
  const currentPrice = parseFloat(pair.priceUsd);
  const dropRatio = (localHigh - currentPrice) / localHigh;
  return dropRatio >= TREND_BREAK_DROP_RATIO && pair.priceChange.h1 < 0;
}
