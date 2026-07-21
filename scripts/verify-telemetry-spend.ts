/**
 * Import fixtures/telemetry-spend-full.csv into a fresh org and assert:
 *   - sum(cost_records.effective_cost) == CSV sum (±$0.01)
 *   - Brief trailing-30d == CSV rows whose month-grain charge day falls in window
 *   - AI Cost trailing-30d == Claude+Cursor+Copilot+ChatGPT subset in that window
 *   - Gemini + Perplexity appear in FinOps / cost_records, not AI Cost
 *
 * Usage: npx tsx scripts/verify-telemetry-spend.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { db, assertDb } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseCsv } from "@/lib/import/parse";
import {
  parseImportTimestamp,
  resolveCodingToolKey,
  resolveProviderKey,
  TELEMETRY_TEMPLATE,
} from "@/lib/import/telemetry";
import { executeUsageImport } from "@/lib/import/execute";
import { wipeWorkspaceForSample, clearSampleFlag } from "@/lib/demo/finopsSample";
import { getBriefFacts, trailingBriefPeriod } from "@/lib/queries/brief";
import { getAiCostSummary } from "@/lib/queries/ai-cost";

const EPS = 0.01;
const SLUG = "telemetry-spend-verify";

function nearly(a: number, b: number, eps = EPS) {
  return Math.abs(a - b) <= eps;
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

async function main() {
  const path = join(process.cwd(), "fixtures/telemetry-spend-full.csv");
  const raw = readFileSync(path, "utf8");
  const parsed = parseCsv(raw);
  if (!parsed.rows.length) throw new Error("fixture empty");

  let csvSum = 0;
  let csvWindow = 0;
  let csvCodingWindow = 0;
  const period = trailingBriefPeriod(30);
  const tools = new Map<string, number>();
  const providers = new Map<string, number>();

  for (const row of parsed.rows) {
    const spend = Number(String(row.total_spend_dollars ?? "").replace(/[$,]/g, ""));
    if (!Number.isFinite(spend)) throw new Error(`bad spend: ${row.total_spend_dollars}`);
    csvSum += spend;
    const tool = String(row.ai_tool ?? "").trim();
    tools.set(tool, (tools.get(tool) ?? 0) + spend);
    const pk = resolveProviderKey(tool);
    providers.set(pk, (providers.get(pk) ?? 0) + 1);

    const ts = parseImportTimestamp(String(row.month ?? ""));
    if (!ts) throw new Error(`bad month: ${row.month}`);
    const inWindow =
      ts.start.getTime() >= period.start.getTime() &&
      ts.start.getTime() < period.end.getTime();
    if (inWindow) {
      csvWindow += spend;
      if (resolveCodingToolKey(tool)) csvCodingWindow += spend;
    }
  }

  console.log("CSV rows", parsed.rows.length);
  console.log("CSV sum", csvSum.toFixed(2));
  console.log("CSV trailing-30d (month-grain)", csvWindow.toFixed(2), period.label);
  console.log("CSV coding trailing-30d", csvCodingWindow.toFixed(2));
  console.log("tools", Object.fromEntries(tools));
  console.log("provider keys", Object.fromEntries(providers));

  for (const tool of [
    "Gemini",
    "Perplexity",
    "GitHub Copilot",
    "Claude",
    "Cursor",
    "ChatGPT Enterprise",
  ]) {
    if (!tools.has(tool)) throw new Error(`missing tool in fixture: ${tool}`);
    if (!resolveProviderKey(tool)) throw new Error(`no provider for ${tool}`);
  }
  if (resolveCodingToolKey("Gemini") != null) {
    throw new Error("Gemini must not be a coding tool");
  }
  if (resolveCodingToolKey("Perplexity") != null) {
    throw new Error("Perplexity must not be a coding tool");
  }

  await assertDb();
  let [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, SLUG))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(s.organizations)
      .values({ name: "Telemetry Spend Verify", slug: SLUG })
      .returning();
  }

  await wipeWorkspaceForSample(org.id);
  await clearSampleFlag(org.id);

  const [batch] = await db
    .insert(s.importBatches)
    .values({
      orgId: org.id,
      sourceKind: "csv",
      fileName: "telemetry-spend-full.csv",
      contentHash: `verify-full-${Date.now()}`,
      status: "importing",
      rowCount: parsed.rows.length,
    })
    .returning();

  const result = await executeUsageImport({
    orgId: org.id,
    batchId: batch.id,
    rows: parsed.rows,
    columnMap: TELEMETRY_TEMPLATE.columnMap,
    sourceKind: "csv",
  });

  await db
    .update(s.importBatches)
    .set({
      status: result.errored && !result.written ? "failed" : "completed",
      rowsWritten: result.written,
      rowsSkipped: result.skipped,
      rowsErrored: result.errored,
      errorReport: result.errors.slice(0, 20),
    })
    .where(eq(s.importBatches.id, batch.id));

  console.log("import", {
    written: result.written,
    skipped: result.skipped,
    errored: result.errored,
    sampleErrors: result.errors.slice(0, 5),
  });

  if (result.errored > 0) {
    console.error("FAIL: import errors", result.errors.slice(0, 20));
    process.exit(1);
  }
  if (result.written !== parsed.rows.length) {
    console.error(
      `FAIL: written ${result.written} != csv rows ${parsed.rows.length}`
    );
    process.exit(1);
  }

  const dbSumRows = await db.execute(sql`
    select coalesce(sum(effective_cost), 0)::text as spend
    from cost_records
    where org_id = ${org.id}::uuid
  `);
  const dbSum = Number(asRows<{ spend: string }>(dbSumRows)[0]?.spend ?? 0);

  const facts = await getBriefFacts(org.id, period);
  const ai = await getAiCostSummary(org.id, { days: 30 });

  const byToolDb = await db.execute(sql`
    select
      coalesce(nullif(trim(tags->>'ai_tool'), ''), 'unknown') as tool,
      coalesce(sum(effective_cost), 0)::text as spend
    from cost_records
    where org_id = ${org.id}::uuid
    group by 1
    order by 2 desc
  `);
  const toolSpend = Object.fromEntries(
    asRows<{ tool: string; spend: string }>(byToolDb).map((r) => [
      r.tool,
      Number(r.spend),
    ])
  );

  const checks: Record<string, boolean> = {
    dbEqualsCsv: nearly(dbSum, csvSum),
    allTimeEqualsCsv: nearly(facts.allTimeSpend, csvSum),
    briefWindowEqualsCsvWindow: nearly(facts.totalSpend, csvWindow),
    vendorSumEqualsBrief: nearly(
      facts.byVendor.reduce((a, r) => a + r.spend, 0),
      facts.totalSpend
    ),
    aiCostEqualsCodingWindow: nearly(ai.spend.value, csvCodingWindow),
    geminiInFinops: (toolSpend["Gemini"] ?? 0) > 0,
    perplexityInFinops: (toolSpend["Perplexity"] ?? 0) > 0,
    noGeminiInAiCost: !ai.byTool.some((t) => /gemini|google/i.test(t.toolKey)),
    noPerplexityInAiCost: !ai.byTool.some((t) => /perplexity/i.test(t.toolKey)),
    chatgptMapped: (toolSpend["ChatGPT Enterprise"] ?? 0) > 0,
    copilotMapped: (toolSpend["GitHub Copilot"] ?? 0) > 0,
  };

  console.log("\nDB all-time", dbSum.toFixed(2));
  console.log("Brief allTimeSpend", facts.allTimeSpend.toFixed(2));
  console.log("Brief period total", facts.totalSpend.toFixed(2), facts.period.label);
  console.log(
    "Brief byVendor",
    facts.byVendor.map((v) => `${v.name}=${v.spend.toFixed(2)}`).join(", ")
  );
  console.log("AI Cost spend", ai.spend.value.toFixed(2), `${ai.from}→${ai.to}`);
  console.log(
    "AI Cost byTool",
    ai.byTool.map((t) => `${t.toolKey}=${t.spend.toFixed(2)}`).join(", ")
  );
  console.log("checks", checks);

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length) {
    console.error("FAIL", failed.map(([k]) => k));
    process.exit(1);
  }
  console.log("\nOK — import total matches CSV; windows reconcile.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
