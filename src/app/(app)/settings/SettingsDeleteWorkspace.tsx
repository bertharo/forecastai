"use client";

import { useRouter } from "next/navigation";
import { DeleteWorkspaceButton } from "@/components/DeleteWorkspaceButton";

/** Danger-zone delete that leaves Settings after the current workspace is gone. */
export function SettingsDeleteWorkspace({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const router = useRouter();

  return (
    <DeleteWorkspaceButton
      orgId={orgId}
      orgName={orgName}
      onDeleted={(nextOrgId) => {
        router.push(nextOrgId ? "/" : "/onboarding");
      }}
    />
  );
}
