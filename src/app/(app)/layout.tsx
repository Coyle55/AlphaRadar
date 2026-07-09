import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getLastScanTime } from "@/lib/db/scanRuns";
import { timeAgo } from "@/lib/format";
import { AccountMenu } from "@/components/AccountMenu";
import { ScanTrigger } from "@/components/ScanTrigger";
import { RadarSweep } from "@/components/RadarSweep";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const lastScanTime = await getLastScanTime();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
        <nav className="flex items-center gap-6">
          <span className="font-mono text-lg tracking-wide text-amber">ALPHARADAR</span>
          <Link href="/" className="text-sm text-ink/60 hover:text-amber">
            Discovery
          </Link>
          <Link href="/positions" className="text-sm text-ink/60 hover:text-amber">
            Positions
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {lastScanTime && (
            <div className="hidden items-center gap-2 font-mono text-xs text-ink/40 sm:flex">
              <RadarSweep size={14} />
              <span>Last scanned {timeAgo(lastScanTime)}</span>
            </div>
          )}
          <ScanTrigger variant="badge" />
          <AccountMenu email={user.email} />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
