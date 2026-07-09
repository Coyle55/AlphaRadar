import { ALERT_LABELS, escapeMarkdown } from '../alerts/format';
import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

export function formatPositionAlertMessage(alertType: AlertType, pair: DexScreenerPair, entryPrice: number): string {
  const label = ALERT_LABELS[alertType];
  const symbol = escapeMarkdown(pair.baseToken.symbol);
  const currentPrice = parseFloat(pair.priceUsd);
  const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const changeText = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`;
  return [
    `*${label}*: ${symbol}`,
    `Entry: $${entryPrice}`,
    `Current: $${pair.priceUsd} (${changeText})`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
