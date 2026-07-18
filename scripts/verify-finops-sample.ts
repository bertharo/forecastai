/**
 * Load sample pack into first org (or create temp) and assert invariants.
 * Usage: npx tsx scripts/verify-finops-sample.ts [orgId]
 */
import "dotenv/config";
import { db, assertDb } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { loadFinopsSamplePack } from "@/lib/demo/finopsSample";
import {
  getFinopsFindings,
  getSpendByDepartment,
  getAttributionCoverage,
} from "@/lib/queries/finops";

async function main() {
  await assertDb();
  let orgId = process.argv[2];
  if (!orgId) {
    const [org] = await db.select().from(s.organizations).limit(1);
    if (!org) throw new Error("No org — pass orgId");
    orgId = org.id;
    console.log("Using org", org.name, orgId);
  }

  console.time("load");
  const result = await loadFinopsSamplePack(orgId);
  console.timeEnd("load");
  console.log("load result", result);

  const [roster] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, orgId));
  const [term] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.contributors)
    .where(
      sql`${s.contributors.orgId} = ${orgId}::uuid and ${s.contributors.employmentStatus} = 'terminated'`
    );
  const [unmapped] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.providerKeyRegistry)
    .where(
      sql`${s.providerKeyRegistry.orgId} = ${orgId}::uuid and ${s.providerKeyRegistry.kind} = 'api_key' and ${s.providerKeyRegistry.dimensionNodeId} is null`
    );

  const findings = await getFinopsFindings(orgId);
  const depts = await getSpendByDepartment(orgId, 30);
  const coverage = await getAttributionCoverage(orgId, 30);

  const checks = {
    roster: Number(roster.n) === 2000,
    terminated: Number(term.n) === 6,
    unmappedKeys: Number(unmapped.n) === 2,
    terminatedSeatCost: result.terminatedSeatMonthlyCost === 1200,
    inactiveSeats: result.inactiveSeats === 18,
    findingsHasTerminated: findings.some((f) => f.id === "terminated_seats"),
    findingsHasInactive: findings.some((f) => f.id === "inactive_seats"),
    findingsHasKeys: findings.some((f) => f.id === "unmapped_keys"),
    hasDeptSpend: depts.some((d) => d.source === "roster" && d.spend > 0),
    coverageSpendWeighted: coverage.totalSpend > 0,
  };

  console.log("checks", checks);
  console.log(
    "findings",
    findings.map((f) => ({ id: f.id, count: f.count, impact: f.monthlyImpact }))
  );
  console.log("top depts", depts.slice(0, 5));
  console.log("coverage", coverage);

  const failed = Object.entries(checks).filter(([, v]) => !v);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k));
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
