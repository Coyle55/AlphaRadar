export interface ChartPoint {
  priceUsd: number;
  capturedAt: string;
}

export function computeChartPolyline(history: ChartPoint[], width: number, height: number): string {
  if (history.length < 2) {
    return "";
  }

  const prices = history.map((point) => point.priceUsd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  return history
    .map((point, index) => {
      const x = (index / (history.length - 1)) * width;
      const y = height - ((point.priceUsd - minPrice) / priceRange) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
