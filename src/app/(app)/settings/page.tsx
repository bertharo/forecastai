import { LoadSampleButton } from "@/components/LoadSampleButton";
import { getCurrentOrg, getOrgById } from "@/lib/queries/org";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <EmptyState
        message="Open a workspace to manage settings."
        action={{ href: "/onboarding", label: "Open Workspaces" }}
      />
    );
  }

  const full = await getOrgById(org.id);
  const sampleActive = Boolean(full?.sampleDataLoadedAt);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="panel space-y-3 p-4">
        <h2 className="text-[15px] font-semibold">Sample data</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {sampleActive
            ? "This workspace is showing the clean sample pack. Resetting replaces all spend, roster, keys, and uploads again."
            : "Load or reset the deterministic sample pack. This replaces all spend, roster, keys, and past uploads in this workspace."}
        </p>
        <LoadSampleButton
          label="Reset to clean sample"
          className="btn btn-ghost"
          replaceExisting
        />
      </div>

      <div className="panel space-y-3 p-4">
        <h2 className="text-[15px] font-semibold">Price cards</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Vendor pricing tables live under Sources.
        </p>
        <Link href="/connectors#price-cards" className="btn btn-ghost inline-block">
          Open price cards →
        </Link>
      </div>
    </div>
  );
}
