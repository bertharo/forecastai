import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { previewOrApplyRule } from "@/lib/allocation/retroactive";
import type { NormalizedUsageEvent } from "@/lib/connectors/types";

export type KeyKind = "api_key" | "workspace";

export type RegistryRow = {
  id: string;
  kind: KeyKind;
  externalId: string;
  displayName: string | null;
  dimensionNodeId: string | null;
  isServiceAccount: boolean;
  serviceLabel: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  spend30d: number;
  nodeKey: string | null;
  nodeName: string | null;
  mapped: boolean;
};

async function anthropicProviderId(): Promise<string | null> {
  const [p] = await db
    .select({ id: s.providers.id })
    .from(s.providers)
    .where(eq(s.providers.key, "anthropic"))
    .limit(1);
  return p?.id ?? null;
}

/** Upsert discovered keys/workspaces from sync events. */
export async function discoverKeysFromEvents(
  orgId: string,
  events: NormalizedUsageEvent[]
): Promise<{ discovered: number; newUnmapped: number }> {
  const providerId = await anthropicProviderId();
  if (!providerId) return { discovered: 0, newUnmapped: 0 };

  const seen = new Map<string, { kind: KeyKind; externalId: string; at: Date }>();
  for (const ev of events) {
    if (ev.providerKey !== "anthropic") continue;
    const apiKey = (ev.tags?.api_key ?? "").trim();
    const workspace = (ev.tags?.workspace ?? "").trim();
    if (apiKey && apiKey !== "unknown") {
      seen.set(`api_key:${apiKey}`, {
        kind: "api_key",
        externalId: apiKey,
        at: ev.eventTime,
      });
    }
    if (workspace && workspace !== "default") {
      seen.set(`workspace:${workspace}`, {
        kind: "workspace",
        externalId: workspace,
        at: ev.eventTime,
      });
    }
  }

  let discovered = 0;
  let newUnmapped = 0;
  for (const item of seen.values()) {
    const [existing] = await db
      .select()
      .from(s.providerKeyRegistry)
      .where(
        and(
          eq(s.providerKeyRegistry.orgId, orgId),
          eq(s.providerKeyRegistry.providerId, providerId),
          eq(s.providerKeyRegistry.kind, item.kind),
          eq(s.providerKeyRegistry.externalId, item.externalId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(s.providerKeyRegistry)
        .set({
          lastSeenAt:
            item.at > existing.lastSeenAt ? item.at : existing.lastSeenAt,
        })
        .where(eq(s.providerKeyRegistry.id, existing.id));
      discovered++;
    } else {
      await db.insert(s.providerKeyRegistry).values({
        orgId,
        providerId,
        kind: item.kind,
        externalId: item.externalId,
        displayName: item.externalId,
        firstSeenAt: item.at,
        lastSeenAt: item.at,
      });
      discovered++;
      newUnmapped++;
    }
  }
  return { discovered, newUnmapped };
}

/** Also discover from historical cost tags (backfill registry). */
export async function discoverKeysFromCostHistory(orgId: string): Promise<number> {
  const providerId = await anthropicProviderId();
  if (!providerId) return 0;

  const costs = await db
    .select({
      tags: s.costRecords.tags,
      at: s.costRecords.chargePeriodStart,
    })
    .from(s.costRecords)
    .where(
      and(eq(s.costRecords.orgId, orgId), eq(s.costRecords.providerId, providerId))
    )
    .orderBy(desc(s.costRecords.chargePeriodStart))
    .limit(8000);

  const events: NormalizedUsageEvent[] = [];
  for (const c of costs) {
    const tags = (c.tags ?? {}) as Record<string, string>;
    if (!tags.api_key && !tags.workspace) continue;
    events.push({
      eventTime: c.at ?? new Date(),
      providerKey: "anthropic",
      skuId: null,
      meterKey: "input_tokens",
      consumedQuantity: 0,
      consumedUnit: "Tokens",
      tags: {
        ...(tags.api_key ? { api_key: tags.api_key } : {}),
        ...(tags.workspace ? { workspace: tags.workspace } : {}),
        source: tags.source ?? "anthropic_admin",
      },
      serviceName: "Claude API",
    });
  }
  const res = await discoverKeysFromEvents(orgId, events);
  return res.discovered;
}

/**
 * Inject team/dept keys + lane from registry so allocation_rules / tag fallback apply.
 */
export async function enrichTagsFromKeyRegistry(
  orgId: string,
  tags: Record<string, string>
): Promise<Record<string, string>> {
  const providerId = await anthropicProviderId();
  if (!providerId) return tags;

  const out = { ...tags };
  const apiKey = (tags.api_key ?? "").trim();
  const workspace = (tags.workspace ?? "").trim();

  const candidates: { kind: KeyKind; externalId: string }[] = [];
  if (apiKey) candidates.push({ kind: "api_key", externalId: apiKey });
  if (workspace) candidates.push({ kind: "workspace", externalId: workspace });

  for (const c of candidates) {
    const [row] = await db
      .select({
        registry: s.providerKeyRegistry,
        node: s.dimensionNodes,
        typeKey: s.dimensionTypes.key,
      })
      .from(s.providerKeyRegistry)
      .leftJoin(
        s.dimensionNodes,
        eq(s.providerKeyRegistry.dimensionNodeId, s.dimensionNodes.id)
      )
      .leftJoin(
        s.dimensionTypes,
        eq(s.dimensionNodes.dimensionTypeId, s.dimensionTypes.id)
      )
      .where(
        and(
          eq(s.providerKeyRegistry.orgId, orgId),
          eq(s.providerKeyRegistry.providerId, providerId),
          eq(s.providerKeyRegistry.kind, c.kind),
          eq(s.providerKeyRegistry.externalId, c.externalId)
        )
      )
      .limit(1);

    if (!row) continue;
    if (row.registry.isServiceAccount) {
      out.lane = "service_account";
      if (row.registry.serviceLabel) out.service_label = row.registry.serviceLabel;
    } else {
      out.lane = out.lane ?? "human";
    }
    // Prefer api_key mapping over workspace when both set type keys
    if (row.node && row.typeKey && !out[row.typeKey]) {
      out[row.typeKey] = row.node.key;
    }
    // api_key mapping wins — break after first mapped api_key
    if (c.kind === "api_key" && row.node) break;
  }
  return out;
}

export async function countUnmappedKeys(orgId: string): Promise<number> {
  const providerId = await anthropicProviderId();
  if (!providerId) return 0;
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.providerKeyRegistry)
    .where(
      and(
        eq(s.providerKeyRegistry.orgId, orgId),
        eq(s.providerKeyRegistry.providerId, providerId),
        isNull(s.providerKeyRegistry.dimensionNodeId)
      )
    );
  return Number(row?.n ?? 0);
}

export async function listKeyRegistry(
  orgId: string,
  opts?: { unmappedOnly?: boolean }
): Promise<RegistryRow[]> {
  await discoverKeysFromCostHistory(orgId).catch(() => 0);

  const providerId = await anthropicProviderId();
  if (!providerId) return [];

  const filters = [
    eq(s.providerKeyRegistry.orgId, orgId),
    eq(s.providerKeyRegistry.providerId, providerId),
  ];
  if (opts?.unmappedOnly) {
    filters.push(isNull(s.providerKeyRegistry.dimensionNodeId));
  }

  const rows = await db
    .select({
      id: s.providerKeyRegistry.id,
      kind: s.providerKeyRegistry.kind,
      externalId: s.providerKeyRegistry.externalId,
      displayName: s.providerKeyRegistry.displayName,
      dimensionNodeId: s.providerKeyRegistry.dimensionNodeId,
      isServiceAccount: s.providerKeyRegistry.isServiceAccount,
      serviceLabel: s.providerKeyRegistry.serviceLabel,
      firstSeenAt: s.providerKeyRegistry.firstSeenAt,
      lastSeenAt: s.providerKeyRegistry.lastSeenAt,
      nodeKey: s.dimensionNodes.key,
      nodeName: s.dimensionNodes.displayName,
    })
    .from(s.providerKeyRegistry)
    .leftJoin(
      s.dimensionNodes,
      eq(s.providerKeyRegistry.dimensionNodeId, s.dimensionNodes.id)
    )
    .where(and(...filters))
    .orderBy(asc(s.providerKeyRegistry.kind), asc(s.providerKeyRegistry.externalId));

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceIso = since.toISOString();

  const spendRows = await db
    .select({
      apiKey: sql<string>`${s.costRecords.tags}->>'api_key'`,
      workspace: sql<string>`${s.costRecords.tags}->>'workspace'`,
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        eq(s.costRecords.providerId, providerId),
        sql`${s.costRecords.chargePeriodStart} >= ${sinceIso}::timestamptz`
      )
    )
    .groupBy(
      sql`${s.costRecords.tags}->>'api_key'`,
      sql`${s.costRecords.tags}->>'workspace'`
    );

  const spendByKey = new Map<string, number>();
  const spendByWs = new Map<string, number>();
  for (const r of spendRows) {
    if (r.apiKey) {
      spendByKey.set(r.apiKey, (spendByKey.get(r.apiKey) ?? 0) + Number(r.spend));
    }
    if (r.workspace) {
      spendByWs.set(
        r.workspace,
        (spendByWs.get(r.workspace) ?? 0) + Number(r.spend)
      );
    }
  }

  const mapped: RegistryRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as KeyKind,
    externalId: r.externalId,
    displayName: r.displayName,
    dimensionNodeId: r.dimensionNodeId,
    isServiceAccount: r.isServiceAccount,
    serviceLabel: r.serviceLabel,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    nodeKey: r.nodeKey,
    nodeName: r.nodeName,
    mapped: Boolean(r.dimensionNodeId),
    spend30d:
      r.kind === "api_key"
        ? spendByKey.get(r.externalId) ?? 0
        : spendByWs.get(r.externalId) ?? 0,
  }));

  mapped.sort((a, b) => b.spend30d - a.spend30d);
  return mapped;
}

/**
 * Assign registry row → dimension node (+ optional SA). Creates allocation rule
 * and runs existing retroactive machinery.
 */
export async function assignKeyRegistry(
  orgId: string,
  opts: {
    registryId: string;
    dimensionNodeId?: string | null;
    isServiceAccount?: boolean;
    serviceLabel?: string | null;
    displayName?: string | null;
  }
) {
  const [row] = await db
    .select()
    .from(s.providerKeyRegistry)
    .where(
      and(
        eq(s.providerKeyRegistry.id, opts.registryId),
        eq(s.providerKeyRegistry.orgId, orgId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Key not found");

  const nextNodeId =
    opts.dimensionNodeId !== undefined
      ? opts.dimensionNodeId
      : row.dimensionNodeId;

  let node: typeof s.dimensionNodes.$inferSelect | null = null;
  let typeKey: string | null = null;
  if (nextNodeId) {
    const [joined] = await db
      .select({
        node: s.dimensionNodes,
        typeKey: s.dimensionTypes.key,
      })
      .from(s.dimensionNodes)
      .innerJoin(
        s.dimensionTypes,
        eq(s.dimensionNodes.dimensionTypeId, s.dimensionTypes.id)
      )
      .where(
        and(
          eq(s.dimensionNodes.id, nextNodeId),
          eq(s.dimensionNodes.orgId, orgId)
        )
      )
      .limit(1);
    if (!joined) throw new Error("Team / department not found");
    node = joined.node;
    typeKey = joined.typeKey;
  }

  const [updated] = await db
    .update(s.providerKeyRegistry)
    .set({
      dimensionNodeId: nextNodeId,
      isServiceAccount: opts.isServiceAccount ?? row.isServiceAccount,
      serviceLabel:
        opts.serviceLabel !== undefined ? opts.serviceLabel : row.serviceLabel,
      displayName:
        opts.displayName !== undefined ? opts.displayName : row.displayName,
    })
    .where(eq(s.providerKeyRegistry.id, row.id))
    .returning();

  let retro: Awaited<ReturnType<typeof previewOrApplyRule>> | null = null;

  if (node && typeKey) {
    const matchKey = row.kind === "api_key" ? "api_key" : "workspace";
    const match = { [matchKey]: row.externalId };
    const set = { [typeKey]: node.key };
    const ruleName = `Key registry · ${row.kind} ${row.externalId}`;

    const [existingRule] = await db
      .select()
      .from(s.allocationRules)
      .where(and(eq(s.allocationRules.orgId, orgId), eq(s.allocationRules.name, ruleName)))
      .limit(1);

    if (existingRule) {
      await db
        .update(s.allocationRules)
        .set({ match, set, priority: 10 })
        .where(eq(s.allocationRules.id, existingRule.id));
      retro = await previewOrApplyRule(
        orgId,
        {
          id: existingRule.id,
          name: ruleName,
          priority: 10,
          match,
          set,
        },
        { apply: true, appliedBy: "key_registry", forceRemap: true }
      );
    } else {
      retro = await previewOrApplyRule(
        orgId,
        {
          name: ruleName,
          priority: 10,
          match,
          set,
        },
        { apply: true, appliedBy: "key_registry", forceRemap: true }
      );
    }
  }

  return { registry: updated, retro };
}
