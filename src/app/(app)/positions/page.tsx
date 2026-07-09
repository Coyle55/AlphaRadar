import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getClosedPositionsForUser, getOpenPositionsForUser } from "@/lib/db/positions";
import { formatUsd } from "@/lib/format";
import { LogPositionForm } from "@/components/LogPositionForm";
import { OpenPositionRow } from "@/components/OpenPositionRow";

export default async function PositionsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [openPositions, closedPositions] = await Promise.all([
    getOpenPositionsForUser(user.id),
    getClosedPositionsForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <LogPositionForm />

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Open Positions</h2>
        {openPositions.length === 0 ? (
          <p className="text-sm text-ink/50">No open positions yet — log one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse font-mono text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                  <th className="py-2 pr-4 font-normal">Token</th>
                  <th className="py-2 pr-4 text-right font-normal">Entry</th>
                  <th className="py-2 pr-4 text-right font-normal">Current</th>
                  <th className="py-2 pr-4 text-right font-normal">P&amp;L</th>
                  <th className="py-2 pr-4 text-right font-normal">Amount</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 text-right font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((position) => (
                  <OpenPositionRow key={position.id} position={position} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Closed Positions</h2>
        {closedPositions.length === 0 ? (
          <p className="text-sm text-ink/50">No closed positions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse font-mono text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                  <th className="py-2 pr-4 font-normal">Token</th>
                  <th className="py-2 pr-4 text-right font-normal">Entry</th>
                  <th className="py-2 pr-4 text-right font-normal">Exit</th>
                  <th className="py-2 pr-4 text-right font-normal">P&amp;L</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 text-right font-normal">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((position) => {
                  const pnlPercent = ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100;
                  return (
                    <tr key={position.id} className="border-b border-ink/5">
                      <td className="py-3 pr-4">
                        <div className="font-medium text-ink">{position.symbol}</div>
                        <div className="text-xs text-ink/40">{position.name}</div>
                      </td>
                      <td className="py-3 pr-4 text-right">{formatUsd(position.entryPrice)}</td>
                      <td className="py-3 pr-4 text-right">{formatUsd(position.exitPrice)}</td>
                      <td className="py-3 pr-4 text-right">
                        <span className={pnlPercent >= 0 ? "text-signal-green" : "text-signal-red"}>
                          {pnlPercent >= 0 ? "+" : ""}
                          {pnlPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right text-ink/50">
                        {new Date(position.openedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-right text-ink/50">
                        {new Date(position.closedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
