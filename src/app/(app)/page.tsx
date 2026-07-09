import { getDiscoveryFeed } from "@/lib/db/discoveryFeed";
import { RadarSweep } from "@/components/RadarSweep";

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1m ago";
  return `${minutes}m ago`;
}

export default async function DiscoveryFeedPage() {
  const feed = await getDiscoveryFeed();

  if (feed.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <RadarSweep size={64} />
        <p className="text-ink/70">No tokens scored in the last 2 hours.</p>
        <p className="text-sm text-ink/40">The scanner runs on its own schedule — check back shortly.</p>
      </div>
    );
  }

  const maxScore = Math.max(1, ...feed.map((item) => item.totalScore));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-ink/50">
        <RadarSweep size={16} />
        <span>Last scanned {timeAgo(feed[0].capturedAt)}</span>
      </div>
      <table className="w-full border-collapse font-mono text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
            <th className="py-2 pr-4 font-normal">#</th>
            <th className="py-2 pr-4 font-normal">Token</th>
            <th className="py-2 pr-4 font-normal">Signal</th>
            <th className="py-2 pr-4 text-right font-normal">Price</th>
            <th className="py-2 pr-4 text-right font-normal">1h Vol</th>
            <th className="py-2 pr-4 text-right font-normal">Liquidity</th>
            <th className="py-2 text-right font-normal">Mkt Cap</th>
          </tr>
        </thead>
        <tbody>
          {feed.map((item, index) => (
            <tr key={item.tokenId} className="border-b border-ink/5">
              <td className="py-3 pr-4 text-ink/40">{index + 1}</td>
              <td className="py-3 pr-4">
                <div className="font-medium text-ink">{item.symbol}</div>
                <div className="text-xs text-ink/40">{item.name}</div>
              </td>
              <td className="py-3 pr-4">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full bg-amber"
                    style={{ width: `${Math.max(4, (item.totalScore / maxScore) * 100)}%` }}
                  />
                </div>
              </td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.priceUsd)}</td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.volume1hUsd)}</td>
              <td className="py-3 pr-4 text-right">{formatUsd(item.liquidityUsd)}</td>
              <td className="py-3 text-right">{formatUsd(item.marketCapUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
