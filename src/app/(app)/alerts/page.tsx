import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getDiscoveryAlerts, getPositionAlertsForUser, type AlertFeedItem, type AlertType } from "@/lib/db/alerts";
import { ALERT_LABELS } from "@/lib/alerts/format";
import { formatUsd, timeAgo } from "@/lib/format";

const POSITIVE_ALERT_TYPES: AlertType[] = ["buy_watch", "volume_spike", "take_profit"];

function alertColorClass(alertType: AlertType): string {
  return POSITIVE_ALERT_TYPES.includes(alertType) ? "text-signal-green" : "text-signal-red";
}

function AlertRowContent({ alert }: { alert: AlertFeedItem }) {
  return (
    <>
      <div className="flex w-full flex-col gap-1 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className={alertColorClass(alert.alertType)}>{ALERT_LABELS[alert.alertType]}</span>
          <span className="text-ink/40">{timeAgo(alert.triggeredAt)}</span>
        </div>
        <div className="truncate text-ink">
          {alert.symbol} <span className="text-ink/40">{alert.name}</span>
        </div>
        <div className="flex items-center gap-4 text-ink/70">
          <span>{formatUsd(alert.priceUsd)}</span>
          <span>{formatUsd(alert.liquidityUsd)}</span>
        </div>
      </div>

      <div className="hidden w-full items-center gap-4 sm:flex">
        <span className={`w-32 shrink-0 ${alertColorClass(alert.alertType)}`}>{ALERT_LABELS[alert.alertType]}</span>
        <span className="flex-1 truncate text-ink">
          {alert.symbol} <span className="text-ink/40">{alert.name}</span>
        </span>
        <span className="shrink-0 text-ink/70">{formatUsd(alert.priceUsd)}</span>
        <span className="shrink-0 text-ink/70">{formatUsd(alert.liquidityUsd)}</span>
        <span className="w-20 shrink-0 text-right text-ink/40">{timeAgo(alert.triggeredAt)}</span>
      </div>
    </>
  );
}

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [discoveryAlerts, positionAlerts] = await Promise.all([
    getDiscoveryAlerts(),
    getPositionAlertsForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Discovery Alerts</h2>
        {discoveryAlerts.length === 0 ? (
          <p className="text-sm text-ink/50">No discovery alerts yet.</p>
        ) : (
          <div className="flex flex-col font-mono text-sm">
            {discoveryAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/token/${alert.mintAddress}`}
                className="block border-t border-ink/10 py-3 first:border-t-0 hover:bg-ink/5"
              >
                <AlertRowContent alert={alert} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink/40">Your Position Alerts</h2>
        {positionAlerts.length === 0 ? (
          <p className="text-sm text-ink/50">No position alerts yet.</p>
        ) : (
          <div className="flex flex-col font-mono text-sm">
            {positionAlerts.map((alert) => (
              <div key={alert.id} className="border-t border-ink/10 py-3 first:border-t-0">
                <AlertRowContent alert={alert} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
