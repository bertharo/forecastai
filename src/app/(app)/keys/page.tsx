import Link from "next/link";
import { getCurrentOrg } from "@/lib/queries/org";
import { countUnmappedKeys, listKeyRegistry } from "@/lib/keys/registry";
import { getDimensionNodes } from "@/lib/queries/org";
import { KeysClient } from "./KeysClient";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <EmptyState
        message="Open a workspace to map API keys."
        action={{ href: "/onboarding", label: "Open Workspaces" }}
      />
    );
  }

  const sp = await searchParams;
  const unmappedOnly =
    sp.unmapped === "1" || sp.unmapped === "true";

  const [keys, unmappedCount, nodes] = await Promise.all([
    listKeyRegistry(org.id, { unmappedOnly }),
    countUnmappedKeys(org.id),
    getDimensionNodes(org.id),
  ]);

  return (
    <div className="space-y-5">
      {keys.length === 0 ? (
        <EmptyState
          message="No keys yet. Sync Anthropic under Sources — keys show up here to map to teams."
          action={{ href: "/connectors", label: "Open Sources" }}
        />
      ) : (
        <p className="text-[14px]" style={{ color: "var(--muted)" }}>
          {unmappedCount > 0 ? (
            <>
              {unmappedCount} key{unmappedCount === 1 ? "" : "s"} still need a team. Start with
              the biggest 30-day spend.{" "}
            </>
          ) : (
            <>All discovered keys are mapped. </>
          )}
          <Link href="/connectors" className="underline">
            Sync from Sources
          </Link>
        </p>
      )}

      {keys.length > 0 && (
        <KeysClient
          initialKeys={keys}
          nodes={nodes.map((n) => ({
            id: n.id,
            key: n.key,
            displayName: n.displayName,
            path: n.path,
          }))}
          unmappedOnly={unmappedOnly}
        />
      )}
    </div>
  );
}
