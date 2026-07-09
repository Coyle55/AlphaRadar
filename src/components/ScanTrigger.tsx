"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "loading" | "cooldown" | "error";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      className={spinning ? "animate-spin" : ""}
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3.6h-3.6" />
    </svg>
  );
}

export function ScanTrigger({ variant }: { variant: "badge" | "button" }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch("/api/scan/trigger", { method: "POST" });

      if (response.status === 429) {
        const body = await response.json();
        setStatus("cooldown");
        setMessage(`Wait ${body.retryAfterSeconds}s`);
        return;
      }

      if (!response.ok) {
        setStatus("error");
        setMessage("Scan failed — try again");
        return;
      }

      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Scan failed — try again");
    }
  }

  const disabled = status === "loading";

  if (variant === "badge") {
    return (
      <div className="relative flex items-center">
        <button
          onClick={handleClick}
          disabled={disabled}
          aria-label="Scan now"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-signal-green/40 bg-panel text-signal-green transition-colors hover:border-signal-green disabled:opacity-40"
        >
          <RefreshIcon spinning={status === "loading"} />
        </button>
        {message && (
          <span className="absolute right-0 top-10 whitespace-nowrap font-mono text-xs text-ink/40">{message}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled}
        className="flex items-center gap-2 border border-amber/40 px-4 py-2 font-mono text-sm text-amber transition-colors hover:border-amber disabled:opacity-40"
      >
        <RefreshIcon spinning={status === "loading"} />
        {status === "loading" ? "Scanning…" : "Scan now"}
      </button>
      {message && <span className="text-xs text-ink/40">{message}</span>}
    </div>
  );
}
