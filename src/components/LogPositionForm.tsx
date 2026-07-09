"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LogPositionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mintAddress, setMintAddress] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAddress,
        entryPrice: Number(entryPrice),
        amount: amount === "" ? undefined : Number(amount),
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    setMintAddress("");
    setEntryPrice("");
    setAmount("");
    setSubmitting(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 border border-ink/20 px-4 py-2 text-sm text-ink/70 hover:border-amber hover:text-amber"
      >
        + Log Position
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3 border border-ink/20 bg-panel p-4">
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Mint Address
        <input
          required
          value={mintAddress}
          onChange={(e) => setMintAddress(e.target.value)}
          className="w-64 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Entry Price (USD)
        <input
          required
          type="number"
          step="any"
          min="0"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          className="w-32 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink/80">
        Amount (optional)
        <input
          type="number"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 rounded border border-ink/20 bg-terminal px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-amber px-4 py-2 font-medium text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Logging…" : "Log Position"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-ink/50 hover:text-ink">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-signal-red">{error}</p>}
    </form>
  );
}
