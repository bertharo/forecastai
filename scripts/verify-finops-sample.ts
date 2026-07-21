/**
 * Load sample pack into an org and assert Brief reconciliation invariants.
 *
 * Usage:
 *   npx tsx scripts/verify-finops-sample.ts [orgId]
 *   npx tsx scripts/verify-finops-sample.ts --fresh
 *   npx tsx scripts/verify-finops-sample.ts --acme /path/to/acme-pack
 *
 * --acme accepts a directory with hris-roster.csv + vendor-*.csv (optional).
 * When provided, imports are attempted on a *separate* fresh org (not mixed with sample).
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { db, assertDb } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { loadFinopsSamplePack } from "@/lib/demo/finopsSample";
import {
  checkBriefInvariants,
  getBriefFacts,
  resolveBriefPeriod,
} from "@/lib/queries/brief";
import { countUnmappedKeys, listKeyRegistry } from "@/lib/keys/registry";
import { importRosterCsv } from "@/lib/roster/import";

async function ensureOrg(slug: string, name: string) {
  const [existing] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, slug))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(s.organizations)
    .values({ name, slug })
    .returning();
  return created;
}

async function assertBrief(orgId: string, label: string) {
  const period = await resolveBriefPeriod(orgId, 30);
  const facts = await getBriefFacts(orgId, period);
  const violations = checkBriefInvariants(facts);
  const unmappedKeys = await countUnmappedKeys(orgId);
  const keyRows = await listKeyRegistry(orgId, { unmappedOnly: true });

  const primaryDim = facts.byDimensions[0];
  const checks: Record<string, boolean> = {
    noViolations: violations.length === 0,
    vendorSum: Math.abs(
      facts.byVendor.reduce((a, r) => a + r.spend, 0) - facts.totalSpend
    ) < 0.02,
    dimSum:
      !primaryDim ||
      Math.abs(
        primaryDim.rows.reduce((a, r) => a + r.spend, 0) - facts.totalSpend
      ) < 0.02,
    attrPartition:
      Math.abs(
        facts.attribution.attributedSpend +
          facts.attribution.unallocatedSpend -
          facts.totalSpend
      ) < 0.02,
    attrComponents:
      Math.abs(
        facts.attribution.emailJoinSpend +
          facts.attribution.keyRegistrySpend -
          facts.attribution.attributedSpend
      ) < 0.02,
    unmappedCountAlign:
      unmappedKeys === facts.unmappedKeyCount &&
      keyRows.filter((k) => k.kind === "api_key").length === unmappedKeys,
    hasDimensions: facts.byDimensions.length > 0,
  };

  console.log(`\n[${label}] total=${facts.totalSpend.toFixed(2)} period=${facts.period.label}`);
  console.log("attribution", facts.attribution);
  console.log(
    "findings",
    facts.findings.map((f) => ({ id: f.id, count: f.count, impact: f.impact }))
  );
  console.log("checks", checks);
  if (violations.length) console.error("violations", violations);

  const failed = Object.entries(checks).filter(([, v]) => !v);
  if (failed.length) {
    throw new Error(`${label} FAILED: ${failed.map(([k]) => k).join(", ")}`);
  }
  return facts;
}

async function main() {
  await assertDb();
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const acmeIdx = args.indexOf("--acme");
  const acmePath = acmeIdx >= 0 ? args[acmeIdx + 1] : null;
  const orgIdArg = args.find((a) => !a.startsWith("--") && a !== acmePath);

  let orgId = orgIdArg;
  if (!orgId || fresh) {
    const org = await ensureOrg(
      "finops-sample-verify",
      "FinOps Sample Verify"
    );
    orgId = org.id;
    console.log("Using org", org.name, orgId);
  }

  console.time("load");
  const result = await loadFinopsSamplePack(orgId!);
  console.timeEnd("load");
  console.log("load result", result);

  const [roster] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, orgId!));
  const [term] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.contributors)
    .where(
      sql`${s.contributors.orgId} = ${orgId!}::uuid and ${s.contributors.employmentStatus} = 'terminated'`
    );
  const [unmapped] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.providerKeyRegistry)
    .where(
      sql`${s.providerKeyRegistry.orgId} = ${orgId!}::uuid and ${s.providerKeyRegistry.kind} = 'api_key' and ${s.providerKeyRegistry.dimensionNodeId} is null`
    );

  const packChecks = {
    roster: Number(roster.n) === 2000,
    terminated: Number(term.n) === 6,
    unmappedKeys: Number(unmapped.n) === 2,
    terminatedSeatCost: result.terminatedSeatMonthlyCost === 1200,
    inactiveSeats: result.inactiveSeats === 18,
  };
  console.log("pack checks", packChecks);
  const packFailed = Object.entries(packChecks).filter(([, v]) => !v);
  if (packFailed.length) {
    console.error("PACK FAILED", packFailed.map(([k]) => k));
    process.exit(1);
  }

  await assertBrief(orgId!, "sample");

  if (acmePath) {
    if (!existsSync(acmePath)) {
      console.error("Acme path not found:", acmePath);
      process.exit(1);
    }
    const acmeOrg = await ensureOrg("acme-brief-verify", "Acme Brief Verify");
    // Separate org — never mix with sample
    const rosterFile = join(acmePath, "hris-roster.csv");
    if (existsSync(rosterFile)) {
      const csv = readFileSync(rosterFile, "utf8");
      const rosterResult = await importRosterCsv(acmeOrg.id, csv);
      console.log("acme roster", rosterResult);
    } else {
      console.warn("No hris-roster.csv in acme path — skipping roster import");
    }
    // Usage CSV import goes through executeUsageImport; accept missing gracefully
    const usageCandidates = [
      "vendor-anthropic-usage.csv",
      "acme-anthropic-usage.csv",
      "anthropic-usage.csv",
    ];
    const usageFile = usageCandidates
      .map((f) => join(acmePath, f))
      .find((p) => existsSync(p));
    if (usageFile) {
      console.log(
        "Acme usage file present at",
        usageFile,
        "— import via UI/API separately; asserting empty-or-roster-only facts"
      );
    }
    // If only roster, facts may be empty of spend — still run partition (zeros ok)
    const facts = await getBriefFacts(acmeOrg.id, await resolveBriefPeriod(acmeOrg.id, 30));
    const v = checkBriefInvariants(facts);
    console.log("[acme] violations", v);
    if (v.length) {
      console.error("ACME BRIEF FAILED");
      process.exit(1);
    }
    console.log("[acme] OK (partition holds)");
  }

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
