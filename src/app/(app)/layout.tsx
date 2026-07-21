import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { HomeTabs } from "@/components/shell/HomeTabs";
import { PlanTabs } from "@/components/shell/PlanTabs";
import { SampleDataWatermark } from "@/components/SampleDataWatermark";
import { getCurrentOrg, getOrgById, listOrgs } from "@/lib/queries/org";
import { countUnmappedKeys } from "@/lib/keys/registry";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let orgs: { id: string; name: string; slug: string; isPrivate?: boolean }[] = [];
  let currentOrg: { id: string; name: string; slug: string; isPrivate?: boolean } | null = null;
  let unmappedKeys = 0;
  let sampleActive = false;
  let pendingDecisions = 0;
  try {
    orgs = await listOrgs();
    const org = await getCurrentOrg();
    currentOrg = org ?? null;
    if (org) {
      unmappedKeys = await countUnmappedKeys(org.id);
      const full = await getOrgById(org.id);
      sampleActive = Boolean(full?.sampleDataLoadedAt);
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.notifications)
        .where(
          and(eq(s.notifications.orgId, org.id), isNull(s.notifications.readAt))
        );
      pendingDecisions = Number(row?.n ?? 0);
    }
  } catch {
    // DB down — shell still renders
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar
        orgs={orgs}
        currentOrg={currentOrg}
        unmappedKeys={unmappedKeys}
        pendingDecisions={pendingDecisions}
      />
      <main className="meter-shell-main min-w-0 flex-1 px-5 pb-8 pt-5 md:px-8 md:pt-6">
        <TopBar orgs={orgs} currentOrg={currentOrg} />
        <Suspense fallback={null}>
          <HomeTabs />
          <PlanTabs />
        </Suspense>
        {children}
        <SampleDataWatermark active={sampleActive} />
      </main>
    </div>
  );
}
