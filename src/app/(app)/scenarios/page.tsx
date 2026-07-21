import { WhatIfScenarios } from "@/components/WhatIfScenarios";
import { getCurrentOrg } from "@/lib/queries/org";
import { EmptyState } from "@/components/EmptyState";
import { getSpendAnchorAndDaily, monthlyTotals } from "@/lib/forecast/trend";
import { getRealTeamUsage } from "@/lib/spend/teams";
import { getObservedModelRates } from "@/lib/spend/rates";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <EmptyState
        message="Open a workspace to try what-if changes."
        action={{ href: "/onboarding", label: "Open Workspaces" }}
      />
    );
  }

  const anchorInfo = await getSpendAnchorAndDaily(org.id);
  if (!anchorInfo) {
    return <WhatIfScenarios teams={null} rates={[]} isDemo />;
  }

  const to = new Date(anchorInfo.anchor.getTime() + 1);
  const from = new Date(anchorInfo.anchor);
  from.setUTCDate(from.getUTCDate() - 30);

  const [teamUsage, rates] = await Promise.all([
    getRealTeamUsage(org.id, { from, to }),
    getObservedModelRates(org.id, { from, to }),
  ]);

  const recentMonths = monthlyTotals(anchorInfo.daily).slice(-3);
  const defaultTypicalSpend = recentMonths.length
    ? recentMonths.reduce((a, m) => a + m.spend, 0) / recentMonths.length
    : undefined;
  const defaultBusyMonth = recentMonths.length
    ? Math.max(...recentMonths.map((m) => m.spend))
    : undefined;

  return (
    <WhatIfScenarios
      teams={teamUsage}
      rates={rates}
      isDemo={teamUsage === null}
      defaultTypicalSpend={defaultTypicalSpend}
      defaultBusyMonth={defaultBusyMonth}
    />
  );
}
