"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RadarSweep } from "@/components/RadarSweep";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Something went wrong. Try again.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4">
      <RadarSweep size={96} />
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-mono text-2xl tracking-wide text-amber">ALPHARADAR</h1>
        <p className="mb-8 text-center text-sm text-ink/60">Create your account</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink/80">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-ink/20 bg-panel px-3 py-2 text-ink outline-none focus:border-amber"
            />
          </label>
          {error && <p className="text-sm text-signal-red">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded bg-amber px-4 py-2 font-medium text-terminal transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="text-amber hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
