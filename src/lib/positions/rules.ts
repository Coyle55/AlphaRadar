import type { DexScreenerPair } from '../dexscreener/types';
import type { ScoreBreakdown } from '../db/tokens';
import type { AlertType } from '../db/alerts';
import type { PriorSnapshot } from '../scan/history';
import { getEffectiveMarketCap } from '../scan/filter';

export interface PositionAlertEvaluationInput {
  pair: DexScreenerPair;
  score: ScoreBreakdown;
  entryPrice: number;
  entryMarketCap: number;
  priorSnapshot: PriorSnapshot | null;
  localHighPrice: number | null;
}

const TAKE_PROFIT_PRICE_MULTIPLE = 2;
const TAKE_PROFIT_MARKET_CAP_MULTIPLE = 2;
const EXIT_WARNING_LIQUIDITY_DROP_RATIO = 0.2;
const EXIT_WARNING_PRICE_DROP_RATIO = 0.25;
const EXIT_WARNING_VOLUME_COLLAPSE_THRESHOLD = -15;

export function evaluatePositionAlerts(input: PositionAlertEvaluationInput): AlertType[] {
  const fired: AlertType[] = [];
  if (evaluatesTakeProfit(input)) fired.push('take_profit');
  if (evaluatesExitWarning(input)) fired.push('exit_warning');
  return fired;
}

function evaluatesTakeProfit(input: PositionAlertEvaluationInput): boolean {
  const currentPrice = parseFloat(input.pair.priceUsd);
  if (currentPrice >= input.entryPrice * TAKE_PROFIT_PRICE_MULTIPLE) return true;

  const currentMarketCap = getEffectiveMarketCap(input.pair);
  if (currentMarketCap !== undefined && currentMarketCap >= input.entryMarketCap * TAKE_PROFIT_MARKET_CAP_MULTIPLE) {
    return true;
  }

  if (input.score.factors.volumeMomentum < 0 && input.pair.priceChange.h1 > 0) return true;

  return false;
}

function evaluatesExitWarning(input: PositionAlertEvaluationInput): boolean {
  const { pair, priorSnapshot, localHighPrice, score } = input;

  const currentLiquidityUsd = pair.liquidity?.usd;
  if (priorSnapshot && priorSnapshot.liquidityUsd > 0 && currentLiquidityUsd !== undefined) {
    const liquidityDropRatio = (priorSnapshot.liquidityUsd - currentLiquidityUsd) / priorSnapshot.liquidityUsd;
    if (liquidityDropRatio >= EXIT_WARNING_LIQUIDITY_DROP_RATIO) return true;
  }

  if (localHighPrice && localHighPrice > 0) {
    const currentPrice = parseFloat(pair.priceUsd);
    const priceDropRatio = (localHighPrice - currentPrice) / localHighPrice;
    if (priceDropRatio >= EXIT_WARNING_PRICE_DROP_RATIO) return true;
  }

  if (score.factors.volumeMomentum <= EXIT_WARNING_VOLUME_COLLAPSE_THRESHOLD) return true;

  return false;
}
