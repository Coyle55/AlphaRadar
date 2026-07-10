"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Discovery" },
  { href: "/positions", label: "Positions" },
  { href: "/alerts", label: "Alerts" },
];

export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-amber/40 bg-panel font-mono text-sm text-amber transition-colors hover:border-amber"
      >
        {(email ?? "?").charAt(0).toUpperCase()}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-menu-in absolute right-0 top-10 z-10 w-56 origin-top-right rounded-none border border-ink/10 bg-panel font-mono text-sm shadow-lg"
        >
          <div className="truncate border-b border-ink/10 px-3 py-2 text-xs text-ink/50">{email ?? "Unknown account"}</div>
          <div className="border-b border-ink/10 sm:hidden">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-ink/70 hover:bg-ink/5 hover:text-amber"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <button
            role="menuitem"
            onClick={handleLogout}
            className="w-full px-3 py-2 text-left text-ink/70 hover:bg-ink/5 hover:text-amber"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
