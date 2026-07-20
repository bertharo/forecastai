import { ClearSampleButton, LoadSampleButton } from "@/components/LoadSampleButton";
import { getCurrentOrg, getOrgById } from "@/lib/queries/org";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { SettingsDeleteWorkspace } from "./SettingsDeleteWorkspace";

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
            ? "Sample pack is active. Clear it before uploading your own people or spend files, or reset to reload the clean pack."
            : "Load the deterministic sample pack, or clear an existing one. These actions replace FinOps spend, roster, keys, and past uploads."}
        </p>
        <div className="flex flex-wrap gap-2">
          {sampleActive && <ClearSampleButton />}
          <LoadSampleButton
            label="Reset to clean sample"
            className="btn btn-ghost"
            replaceExisting
          />
        </div>
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

      <div className="panel space-y-3 p-4">
        <h2 className="text-[15px] font-semibold">Danger zone</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Delete <strong style={{ color: "var(--text)" }}>{org.name}</strong> and all of its
          spend, roster, sources, and settings. Other workspaces are not affected.
        </p>
        <SettingsDeleteWorkspace orgId={org.id} orgName={org.name} />
      </div>
    </div>
  );
}
