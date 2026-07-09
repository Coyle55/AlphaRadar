"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatUsd, timeAgo } from "@/lib/format";

export interface OpenPositionRowData {
  id: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  amount: number | null;
  openedAt: string;
  currentPriceUsd: number | null;
  currentPriceCapturedAt: string | null;
}

export function OpenPositionRow({ position }: { position: OpenPositionRowData }) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [exitPrice, setExitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pnlPercent =
    position.currentPriceUsd === null
      ? null
      : ((position.currentPriceUsd - position.entryPrice) / position.entryPrice) * 100;

  async function handleClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = Number(exitPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive exit price");
      return;
    }

    setSubmitting(true);
    const response = await fetch(`/api/positions/${position.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exitPrice: parsed }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.refresh();
  }

  return (
    <tr className="border-b border-ink/5">
      <td className="py-3 pr-4">
        <div className="font-medium text-ink">{position.symbol}</div>
        <div className="text-xs text-ink/40">{position.name}</div>
      </td>
      <td className="py-3 pr-4 text-right">{formatUsd(position.entryPrice)}</td>
      <td className="py-3 pr-4 text-right">
        {position.currentPriceUsd === null ? (
          <span className="text-ink/40">—</span>
        ) : (
          <>
            <div>{formatUsd(position.currentPriceUsd)}</div>
            {position.currentPriceCapturedAt && (
              <div className="text-xs text-ink/40">last scanned {timeAgo(position.currentPriceCapturedAt)}</div>
            )}
          </>
        )}
      </td>
      <td className="py-3 pr-4 text-right">
        {pnlPercent === null ? (
          <span className="text-ink/40">—</span>
        ) : (
          <span className={pnlPercent >= 0 ? "text-signal-green" : "text-signal-red"}>
            {pnlPercent >= 0 ? "+" : ""}
            {pnlPercent.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-right">
        {position.amount === null ? <span className="text-ink/40">—</span> : position.amount}
      </td>
      <td className="py-3 pr-4 text-right text-ink/50">{new Date(position.openedAt).toLocaleDateString()}</td>
      <td className="py-3 text-right">
        {closing ? (
          <form onSubmit={handleClose} className="flex items-center justify-end gap-2">
            <input
              autoFocus
              type="number"
              step="any"
              min="0"
              placeholder="Exit price"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              className="w-24 rounded border border-ink/20 bg-terminal px-2 py-1 font-mono text-xs text-ink outline-none focus:border-amber"
            />
            <button
              type="submit"
              disabled={submitting}
              className="text-xs text-signal-green hover:opacity-80 disabled:opacity-50"
            >
              {submitting ? "…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setClosing(false);
                setError(null);
              }}
              className="text-xs text-ink/50 hover:text-ink"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button onClick={() => setClosing(true)} className="text-xs text-ink/50 hover:text-signal-red">
            Close
          </button>
        )}
        {error && <div className="mt-1 text-xs text-signal-red">{error}</div>}
      </td>
    </tr>
  );
}
