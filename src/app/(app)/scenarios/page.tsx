import { WhatIfScenarios } from "@/components/WhatIfScenarios";
import { getCurrentOrg } from "@/lib/queries/org";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <div className="soft-card space-y-3" style={{ background: "var(--card-blue)" }}>
        <p className="text-[18px] font-semibold leading-snug">
          Open a workspace to try what-if changes.
        </p>
        <Link href="/onboarding" className="btn inline-block">
          Get started →
        </Link>
      </div>
    );
  }

  return <WhatIfScenarios />;
}
