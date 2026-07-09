import Link from "next/link";
import { getDiscoveryFeed } from "@/lib/db/discoveryFeed";
import { RadarSweep } from "@/components/RadarSweep";
import { ScanTrigger } from "@/components/ScanTrigger";
import { formatUsd, timeAgo } from "@/lib/format";

export default async function DiscoveryFeedPage() {
  const feed = await getDiscoveryFeed();

  if (feed.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <RadarSweep size={64} />
        <p className="text-ink/70">No tokens scored in the last 2 hours.</p>
        <ScanTrigger variant="button" />
      </div>
    );
  }

  const maxScore = Math.max(1, ...feed.map((item) => item.totalScore));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between text-sm text-ink/50 sm:mb-6">
        <div className="flex items-center gap-2">
          <RadarSweep size={16} />
          <span>Last scanned {timeAgo(feed[0].capturedAt)}</span>
        </div>
        <ScanTrigger variant="icon" />
      </div>

      <div className="flex flex-col gap-2 sm:hidden">
        {feed.map((item, index) => (
          <Link
            key={item.tokenId}
            href={`/token/${item.mintAddress}`}
            className="block border border-ink/10 p-3 font-mono text-sm hover:border-amber/40"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-ink/40">{index + 1}</span>
              <span className="font-medium text-ink">{item.symbol}</span>
              <span className="truncate text-xs text-ink/40">{item.name}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-amber"
                style={{ width: `${Math.max(4, (item.totalScore / maxScore) * 100)}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div>
                <div className="uppercase tracking-wide text-ink/40">Price</div>
                <div className="text-ink">{formatUsd(item.priceUsd)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-ink/40">1h Vol</div>
                <div className="text-ink">{formatUsd(item.volume1hUsd)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-ink/40">Liquidity</div>
                <div className="text-ink">{formatUsd(item.liquidityUsd)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-ink/40">Mkt Cap</div>
                <div className="text-ink">{formatUsd(item.marketCapUsd)}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden overflow-x-auto sm:block">
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
                  <Link href={`/token/${item.mintAddress}`} className="block hover:text-amber">
                    <div className="font-medium text-ink">{item.symbol}</div>
                    <div className="text-xs text-ink/40">{item.name}</div>
                  </Link>
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
    </div>
  );
}
