/**
 * Smoke-test people + telemetry CSV mapping (no DB writes for spend mapping helpers).
 * Usage: npx tsx scripts/smoke-telemetry-import.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { parseCsv } from "@/lib/import/parse";
import {
  looksLikeTelemetryHeaders,
  parseImportTimestamp,
  resolveProviderKey,
  TELEMETRY_TEMPLATE,
} from "@/lib/import/telemetry";
import { importRosterCsv } from "@/lib/roster/import";
import { db, assertDb } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { wipeWorkspaceForSample, clearSampleFlag } from "@/lib/demo/finopsSample";

async function main() {
  const peoplePath = join(process.cwd(), "fixtures/people-cost-center-chain.csv");
  const spendPath = join(process.cwd(), "fixtures/telemetry-spend.csv");

  const spend = parseCsv(readFileSync(spendPath, "utf8"));
  console.log("telemetry headers", spend.headers);
  console.log("looksLikeTelemetry", looksLikeTelemetryHeaders(spend.headers));
  console.log("month parse", parseImportTimestamp("2026-06"));
  console.log("tools", {
    Claude: resolveProviderKey("Claude"),
    Cursor: resolveProviderKey("Cursor"),
    ChatGPT: resolveProviderKey("ChatGPT"),
  });
  console.log("template", TELEMETRY_TEMPLATE.name);

  await assertDb();
  let [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, "telemetry-import-smoke"))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(s.organizations)
      .values({ name: "Telemetry Import Smoke", slug: "telemetry-import-smoke" })
      .returning();
  }

  // Clear sample so roster import is allowed
  await wipeWorkspaceForSample(org.id);
  await clearSampleFlag(org.id);

  const peopleCsv = readFileSync(peoplePath, "utf8");
  const roster = await importRosterCsv(org.id, peopleCsv);
  console.log("roster", {
    upserted: roster.upserted,
    skipped: roster.skipped,
    errors: roster.errors,
    detected: roster.detected,
    attributeKeys: roster.attributeKeys,
  });

  const people = await db
    .select({
      email: s.contributors.email,
      attributes: s.contributors.attributes,
    })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id));
  console.log("people rows", people);

  const [orgRow] = await db
    .select({ config: s.organizations.peopleDimensionConfig })
    .from(s.organizations)
    .where(eq(s.organizations.id, org.id))
    .limit(1);

  const alex = people.find((p) => p.email === "alex.chen@acme.example");
  const attrs = alex?.attributes ?? {};
  const enabled = (orgRow?.config?.columns ?? []).filter((c) => c.enabled);
  const ok =
    roster.upserted === 4 &&
    people.some((p) => p.email === "jordan.lee@acme.example") &&
    attrs.cost_center_chain_level_04 === "Engineering" &&
    attrs.cost_center_chain_level_07 === "CC-ENG-AI-01" &&
    attrs.cost_center_chain_level_02 === "Acme Corp" &&
    enabled.length >= 1;
  if (!ok) {
    console.error("SMOKE FAILED", { attrs, enabled });
    process.exit(1);
  }
  console.log("OK", { enabled: enabled.map((c) => c.key) });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
