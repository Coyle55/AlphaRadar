export interface Thesis {
  entry: number;
  stop: number;
  takeProfit1: number;
  takeProfit2: number;
}

export function computeThesis(currentPrice: number): Thesis {
  return {
    entry: currentPrice,
    stop: currentPrice * 0.85,
    takeProfit1: currentPrice * 1.5,
    takeProfit2: currentPrice * 2.0,
  };
}
