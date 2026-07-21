import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { resolveCodingToolKey } from "@/lib/import/telemetry";
import { upsertAiToolDaily, type AiToolDailyRow } from "@/lib/ai-tools/persist";

export type ImportCodingGrain = {
  day: string;
  toolKey: string;
  email: string;
  spend: number;
  tokens: number;
};

const IMPORT_SOURCE = "spreadsheet_import";

function isImportSourceSql() {
  return or(
    eq(s.aiToolDaily.sourceConnector, IMPORT_SOURCE),
    sql`${s.aiToolDaily.sourceConnector} like 'import:%'`
  );
}

/** Clear prior spreadsheet projections so cost_records remain the source of truth. */
async function clearImportProjections(orgId: string) {
  await db
    .delete(s.aiToolDaily)
    .where(and(eq(s.aiToolDaily.orgId, orgId), isImportSourceSql()));
}

/** Aggregate in-memory grains → ai_tool_daily (person/team when email matches roster). */
export async function upsertImportCodingGrains(
  orgId: string,
  grains: ImportCodingGrain[]
) {
  if (!grains.length) return { written: 0 };

  const emails = [
    ...new Set(grains.map((g) => g.email).filter((e) => e && e.includes("@"))),
  ];
  const contributors =
    emails.length === 0
      ? []
      : await db
          .select()
          .from(s.contributors)
          .where(eq(s.contributors.orgId, orgId));
  const byEmail = new Map(
    contributors.map((c) => [c.email.trim().toLowerCase(), c])
  );

  const rows: AiToolDailyRow[] = grains.map((g) => {
    const c = g.email ? byEmail.get(g.email) : undefined;
    // Keep one grain per email even when the roster has no match — otherwise
    // every person collapses to contributorKey "unattributed" and overwrites.
    const contributorKey = c?.id ?? (g.email ? `email:${g.email}` : "unattributed");
    return {
      day: g.day,
      toolKey: g.toolKey,
      contributorId: c?.id ?? null,
      contributorKey,
      dimensionNodeId: c?.dimensionNodeId ?? null,
      spend: g.spend,
      tokensTotal: g.tokens,
      tokensIn: g.tokens,
      sourceConnector: IMPORT_SOURCE,
    };
  });

  return upsertAiToolDaily(orgId, rows);
}

/**
 * Project cost_records from spreadsheet import into ai_tool_daily so AI Cost
 * (person/team) reflects Claude/Cursor/Copilot/ChatGPT rows that never went
 * through connector sync.
 *
 * Replaces prior spreadsheet projections for the org (cost_records win).
 */
export async function projectCodingToolImportsToAiDaily(
  orgId: string
): Promise<{ written: number; grains: number }> {
  const records = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart} at time zone 'UTC')::date::text`,
      aiTool: sql<string>`coalesce(${s.costRecords.tags}->>'ai_tool', '')`,
      email: sql<string>`lower(trim(coalesce(${s.costRecords.tags}->>'email', ${s.costRecords.tags}->>'user_email', '')))`,
      spend: sql<string>`coalesce(${s.costRecords.effectiveCost}, 0)`,
      // Prefer tags.total_tokens (telemetry) — Cursor/Perplexity often land on
      // seats/premium_requests meters whose consumed_unit is not "tokens".
      tokens: sql<string>`coalesce(
        nullif(${s.costRecords.tags}->>'total_tokens', '')::numeric,
        case
          when lower(${s.costRecords.consumedUnit}) = 'tokens'
          then coalesce(${s.costRecords.consumedQuantity}, 0)
          else 0
        end
      )`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        sql`coalesce(${s.costRecords.tags}->>'source', '') = 'import'`
      )
    );

  const grains = new Map<string, ImportCodingGrain>();
  for (const r of records) {
    const toolKey = resolveCodingToolKey(r.aiTool);
    if (!toolKey) continue;
    const day = String(r.day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const email = (r.email ?? "").trim().toLowerCase();
    const key = `${day}|${toolKey}|${email}`;
    const prev = grains.get(key) ?? {
      day,
      toolKey,
      email,
      spend: 0,
      tokens: 0,
    };
    prev.spend += Number(r.spend) || 0;
    prev.tokens += Number(r.tokens) || 0;
    grains.set(key, prev);
  }

  const list = [...grains.values()].filter((g) => g.spend > 0 || g.tokens > 0);
  await clearImportProjections(orgId);
  const result = await upsertImportCodingGrains(orgId, list);
  return { written: result.written, grains: list.length };
}

/** True when coding-tool import spend exists but has not been projected yet. */
export async function needsCodingToolImportProjection(
  orgId: string
): Promise<boolean> {
  const [daily] = await db
    .select({ n: sql<number>`1` })
    .from(s.aiToolDaily)
    .where(and(eq(s.aiToolDaily.orgId, orgId), isImportSourceSql()))
    .limit(1);
  if (daily) return false;

  const candidates = await db
    .select({
      aiTool: sql<string>`coalesce(${s.costRecords.tags}->>'ai_tool', '')`,
      spend: sql<string>`coalesce(${s.costRecords.effectiveCost}, 0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        sql`coalesce(${s.costRecords.tags}->>'source', '') = 'import'`,
        sql`nullif(trim(coalesce(${s.costRecords.tags}->>'ai_tool', '')), '') is not null`
      )
    )
    .limit(500);

  return candidates.some(
    (r) => resolveCodingToolKey(r.aiTool) != null && Number(r.spend) > 0
  );
}
