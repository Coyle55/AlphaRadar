import { computeChartPolyline, type ChartPoint } from "@/lib/chart";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 120;

export function PriceChart({ history }: { history: ChartPoint[] }) {
  if (history.length < 2) {
    return (
      <p className="text-sm text-ink/40">
        Not enough price history yet — check back after a few more scans.
      </p>
    );
  }

  const points = computeChartPolyline(history, CHART_WIDTH, CHART_HEIGHT);
  const prices = history.map((point) => point.priceUsd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const trackedSince = new Date(history[0].capturedAt).toLocaleString();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink/40">
        <span>Tracked since {trackedSince}</span>
        <span>
          {minPrice.toFixed(6)} – {maxPrice.toFixed(6)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Price history chart"
      >
        <polyline points={points} fill="none" className="stroke-amber" strokeWidth={2} />
      </svg>
    </div>
  );
}
