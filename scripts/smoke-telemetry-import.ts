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
  });

  const people = await db
    .select({
      email: s.contributors.email,
      department: s.contributors.department,
      costCenter: s.contributors.costCenter,
    })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id));
  console.log("people rows", people);

  const ok =
    roster.upserted === 4 &&
    people.some((p) => p.department === "Engineering" && p.costCenter === "CC-ENG-AI-01") &&
    people.some((p) => p.email === "jordan.lee@acme.example");
  if (!ok) {
    console.error("SMOKE FAILED");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
