import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { HomeTabs } from "@/components/shell/HomeTabs";
import { getCurrentOrg, listOrgs } from "@/lib/queries/org";
import { countUnmappedKeys } from "@/lib/keys/registry";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let orgs: { id: string; name: string; slug: string }[] = [];
  let currentOrg: { id: string; name: string; slug: string } | null = null;
  let unmappedKeys = 0;
  try {
    orgs = await listOrgs();
    const org = await getCurrentOrg();
    currentOrg = org ?? null;
    if (org) unmappedKeys = await countUnmappedKeys(org.id);
  } catch {
    // DB down — shell still renders
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar orgs={orgs} currentOrg={currentOrg} unmappedKeys={unmappedKeys} />
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
