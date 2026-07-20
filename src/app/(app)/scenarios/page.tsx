import { WhatIfScenarios } from "@/components/WhatIfScenarios";
import { getCurrentOrg } from "@/lib/queries/org";
import { EmptyState } from "@/components/EmptyState";

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

  return <WhatIfScenarios />;
}
