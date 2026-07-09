import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { AccountMenu } from "@/components/AccountMenu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
        <span className="font-mono text-lg tracking-wide text-amber">ALPHARADAR</span>
        <AccountMenu email={user.email} />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
