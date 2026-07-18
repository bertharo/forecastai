import Link from "next/link";
import { getCurrentOrg } from "@/lib/queries/org";
import { countUnmappedKeys, listKeyRegistry } from "@/lib/keys/registry";
import { getDimensionNodes } from "@/lib/queries/org";
import { KeysClient } from "./KeysClient";

export const dynamic = "force-dynamic";

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
        <p className="font-semibold">Open a workspace first</p>
        <a className="btn mt-3 inline-block" href="/onboarding">
          Get started →
        </a>
      </div>
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
      <div className="soft-card" style={{ background: "var(--card-mint)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          API keys
        </div>
        <p className="mt-2 max-w-3xl text-[18px] font-semibold leading-snug">
          Map each Anthropic key (or workspace) to a team — no code changes needed.
        </p>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed" style={{ color: "#3a4050" }}>
          Anthropic only tells us which key spent the money. You say which team owns that
          key. Start with the biggest 30-day spend.{" "}
          {unmappedCount > 0 ? (
            <strong>
              {unmappedCount} still need mapping.
            </strong>
          ) : (
            <span>All discovered keys are mapped.</span>
          )}
        </p>
        <p className="muted mt-2 text-[13px]">
          Keys appear after{" "}
          <Link href="/connectors" className="underline">
            Sources → Anthropic sync
          </Link>
          .
        </p>
      </div>

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
    </div>
  );
}
