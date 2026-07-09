export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1m ago";
  return `${minutes}m ago`;
}

export interface PriceHistoryPoint {
  priceUsd: number;
  capturedAt: string;
}

export interface PriceChange {
  percent: number;
  windowLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computePriceChange(history: PriceHistoryPoint[]): PriceChange | null {
  if (history.length < 2) {
    return null;
  }

  const latest = history[history.length - 1];
  const oldest = history[0];
  const latestTime = new Date(latest.capturedAt).getTime();
  const oldestTime = new Date(oldest.capturedAt).getTime();
  const dayAgoTime = latestTime - DAY_MS;

  const trackedLessThanADay = oldestTime > dayAgoTime;
  const reference = trackedLessThanADay
    ? oldest
    : history.find((point) => new Date(point.capturedAt).getTime() >= dayAgoTime) ?? oldest;

  if (reference.priceUsd === 0) {
    return null;
  }

  const percent = ((latest.priceUsd - reference.priceUsd) / reference.priceUsd) * 100;
  const windowLabel = trackedLessThanADay ? "since first tracked" : "24h";

  return { percent, windowLabel };
}
