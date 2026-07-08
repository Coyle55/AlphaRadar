import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

const ALERT_LABELS: Record<AlertType, string> = {
  buy_watch: 'Buy Watch',
  volume_spike: 'Volume Spike',
  liquidity_danger: 'Liquidity Danger',
  trend_break: 'Trend Break',
};

export function formatAlertMessage(alertType: AlertType, pair: DexScreenerPair): string {
  const label = ALERT_LABELS[alertType];
  const liquidity = pair.liquidity.usd.toLocaleString('en-US');
  return [
    `*${label}*: ${pair.baseToken.symbol} (${pair.baseToken.name})`,
    `Price: $${pair.priceUsd}`,
    `Liquidity: $${liquidity}`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
