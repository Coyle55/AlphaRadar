import { notFound } from "next/navigation";
import Link from "next/link";
import { getTokenDetail } from "@/lib/db/tokenDetail";
import { computeThesis } from "@/lib/scoring/thesis";
import { MAX_POSSIBLE_SCORE } from "@/lib/scoring/score";
import { formatUsd, computePriceChange } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import type { ScoreFactors } from "@/lib/db/tokens";

const FACTOR_LABELS: Record<keyof ScoreFactors, string> = {
  volumeMomentum: "Volume Momentum",
  liquidityGrowth: "Liquidity Growth",
  priceStrength: "Price Strength",
  buySellRatio: "Buy/Sell Ratio",
  marketCapBand: "Market Cap Band",
  liquidityLevel: "Liquidity Level",
  wickRejection: "Wick Rejection",
};

const FACTOR_ORDER: (keyof ScoreFactors)[] = [
  "volumeMomentum",
  "liquidityGrowth",
  "priceStrength",
  "buySellRatio",
  "marketCapBand",
  "liquidityLevel",
  "wickRejection",
];

const FACTOR_MAX_MAGNITUDE: Record<keyof ScoreFactors, number> = {
  volumeMomentum: 20,
  liquidityGrowth: 15,
  priceStrength: 15,
  buySellRatio: 15,
  marketCapBand: 10,
  liquidityLevel: 20,
  wickRejection: 15,
};

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ mintAddress: string }>;
}) {
  const { mintAddress } = await params;
  const detail = await getTokenDetail(mintAddress);

  if (!detail) {
    notFound();
  }

  const thesis = computeThesis(detail.priceUsd);
  const priceChange = computePriceChange(detail.priceHistory);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/" className="mb-4 inline-block text-sm text-ink/50 hover:text-amber">
        ‹ Discovery
      </Link>

      <section className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-2xl text-ink">{detail.symbol}</div>
          <div className="text-sm text-ink/50">{detail.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl text-ink">{formatUsd(detail.priceUsd)}</div>
          {priceChange && (
            <div
              className={`font-mono text-sm ${
                priceChange.percent >= 0 ? "text-signal-green" : "text-signal-red"
              }`}
            >
              {priceChange.percent >= 0 ? "+" : ""}
              {priceChange.percent.toFixed(1)}% {priceChange.windowLabel}
            </div>
          )}
        </div>
      </section>

      <section className="mb-8 flex flex-wrap items-center gap-8 border-b border-ink/10 pb-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Score</div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-xl text-ink">{detail.totalScore.toFixed(1)}</span>
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-amber"
                style={{
                  width: `${Math.max(4, Math.min(100, (detail.totalScore / MAX_POSSIBLE_SCORE) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Liquidity</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.liquidityUsd)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">24h Volume</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.volume24hUsd)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink/40">Market Cap</div>
          <div className="mt-1 font-mono text-ink">{formatUsd(detail.marketCapUsd)}</div>
        </div>
      </section>

      <section className="mb-8 border-b border-ink/10 pb-6">
        <PriceChart history={detail.priceHistory} />
      </section>

      <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-xs uppercase tracking-wide text-ink/40">Score Breakdown</h2>
          <div className="flex flex-col gap-3">
            {FACTOR_ORDER.map((key) => {
              const value = detail.factors[key];
              const max = FACTOR_MAX_MAGNITUDE[key];
              const width = Math.min(100, (Math.abs(value) / max) * 100);
              const positive = value >= 0;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-ink/70">{FACTOR_LABELS[key]}</span>
                    <span className={`font-mono ${positive ? "text-signal-green" : "text-signal-red"}`}>
                      {positive ? "+" : ""}
                      {value.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
                    <div
                      className={`h-full rounded-full ${positive ? "bg-signal-green" : "bg-signal-red"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-1 text-xs uppercase tracking-wide text-amber">
            Mechanical Framework — Not a Prediction
          </h2>
          <p className="mb-4 text-xs text-ink/40">
            Fixed percentage bands off current price. Not a signal to buy — a framework for
            managing risk if you do.
          </p>
          <div className="flex flex-col gap-3 font-mono text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Entry (current price)</span>
              <span className="text-ink">{formatUsd(thesis.entry)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Stop (-15%)</span>
              <span className="text-signal-red">{formatUsd(thesis.stop)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Take-Profit 1 (+50%)</span>
              <span className="text-signal-green">{formatUsd(thesis.takeProfit1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink/70">Take-Profit 2 (+100%)</span>
              <span className="text-signal-green">{formatUsd(thesis.takeProfit2)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
