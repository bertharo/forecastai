import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { HomeTabs } from "@/components/shell/HomeTabs";
import { getCurrentOrg, listOrgs } from "@/lib/queries/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let orgs: { id: string; name: string; slug: string }[] = [];
  let currentOrg: { id: string; name: string; slug: string } | null = null;
  try {
    orgs = await listOrgs();
    const org = await getCurrentOrg();
    currentOrg = org ?? null;
  } catch {
    // DB down — shell still renders
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar orgs={orgs} currentOrg={currentOrg} />
      <main className="meter-shell-main min-w-0 flex-1 px-5 pb-8 pt-5 md:px-8 md:pt-6">
        <TopBar orgs={orgs} currentOrg={currentOrg} />
        <Suspense fallback={null}>
          <HomeTabs />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
