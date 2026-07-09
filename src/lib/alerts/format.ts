import type { AlertType } from '../db/alerts';
import type { DexScreenerPair } from '../dexscreener/types';

export const ALERT_LABELS: Record<AlertType, string> = {
  buy_watch: 'Buy Watch',
  volume_spike: 'Volume Spike',
  liquidity_danger: 'Liquidity Danger',
  trend_break: 'Trend Break',
  take_profit: 'Take Profit',
  exit_warning: 'Exit Warning',
};

export function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[]/g, '\\$&');
}

export function formatAlertMessage(alertType: AlertType, pair: DexScreenerPair): string {
  const label = ALERT_LABELS[alertType];
  const symbol = escapeMarkdown(pair.baseToken.symbol);
  const name = escapeMarkdown(pair.baseToken.name);
  const liquidity = (pair.liquidity?.usd ?? 0).toLocaleString('en-US');
  return [
    `*${label}*: ${symbol} (${name})`,
    `Price: $${pair.priceUsd}`,
    `Liquidity: $${liquidity}`,
    `https://dexscreener.com/solana/${pair.pairAddress}`,
  ].join('\n');
}
