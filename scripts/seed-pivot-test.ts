/**
 * Seeds a local "Pivot Test" workspace: contributors with Workday-style
 * cost_center_chain_level_02..04 attributes + 3 months of ai_tool_daily
 * spend, including partial-path and unattributed rows. Idempotent (wipes
 * and recreates the org by slug).
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bertharo@127.0.0.1:5432/meter";

import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";

const SLUG = "pivot-test";

const people: {
  email: string;
  name: string;
  l2?: string;
  l3?: string;
  l4?: string;
}[] = [
  { email: "a1@pivot.demo", name: "Ada One", l2: "Engineering", l3: "Platform", l4: "AI Platform" },
  { email: "a2@pivot.demo", name: "Ben Two", l2: "Engineering", l3: "Platform", l4: "AI Platform" },
  { email: "a3@pivot.demo", name: "Cal Three", l2: "Engineering", l3: "Platform", l4: "Core Infra" },
  { email: "a4@pivot.demo", name: "Dee Four", l2: "Engineering", l3: "Product Eng" },
  { email: "a5@pivot.demo", name: "Eli Five", l2: "Engineering" }, // partial path → direct under Engineering
  { email: "a6@pivot.demo", name: "Fay Six", l2: "Sales", l3: "Sales Engineering" },
  { email: "a7@pivot.demo", name: "Gus Seven", l2: "Sales", l3: "GTM Field" },
  // Duplicate child name under a different parent — must be a distinct node
  { email: "a8@pivot.demo", name: "Hana Eight", l2: "Sales", l3: "Platform" },
  { email: "a9@pivot.demo", name: "Ivy Nine" }, // no levels at all → Unallocated
];

async function main() {
  const existing = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, SLUG));
  for (const o of existing) {
    await db.delete(s.aiToolDaily).where(eq(s.aiToolDaily.orgId, o.id));
    await db.delete(s.contributors).where(eq(s.contributors.orgId, o.id));
    await db.delete(s.organizations).where(eq(s.organizations.id, o.id));
  }

  const cols = ["02", "03", "04"].map((n, i) => ({
    key: `cost_center_chain_level_${n}`,
    sourceColumn: `Cost Center Chain - Level ${n}`,
    displayName: `Cost Center Chain - Level ${n}`,
    enabled: true,
    role: i === 0 ? ("primary" as const) : null,
    suggestion: "dimension" as const,
    distinctCount: 3,
    sampleValues: [],
  }));

  const [org] = await db
    .insert(s.organizations)
    .values({
      name: "Pivot Test",
      slug: SLUG,
      peopleDimensionConfig: {
        columns: cols,
        profiledAt: new Date().toISOString(),
        rowCount: people.length,
      },
    })
    .returning();

  const contribRows = await db
    .insert(s.contributors)
    .values(
      people.map((p) => ({
        orgId: org.id,
        email: p.email,
        displayName: p.name,
        attributes: {
          ...(p.l2 ? { cost_center_chain_level_02: p.l2 } : {}),
          ...(p.l3 ? { cost_center_chain_level_03: p.l3 } : {}),
          ...(p.l4 ? { cost_center_chain_level_04: p.l4 } : {}),
        },
      }))
    )
    .returning({ id: s.contributors.id, email: s.contributors.email });

  const byEmail = new Map(contribRows.map((c) => [c.email, c.id]));
  const months = ["2026-05", "2026-06", "2026-07"];
  const tools = ["claude_code", "cursor"];
  const rows: (typeof s.aiToolDaily.$inferInsert)[] = [];
  people.forEach((p, pi) => {
    const id = byEmail.get(p.email)!;
    months.forEach((m, mi) => {
      tools.forEach((tool, ti) => {
        const spend = 50 + pi * 10 + mi * 5 + ti * 3;
        rows.push({
          orgId: org.id,
          day: `${m}-15`,
          toolKey: tool,
          contributorKey: id,
          contributorId: id,
          spend: String(spend),
          tokensTotal: String(spend * 15000),
          sessions: 5,
        });
      });
    });
  });
  // Spend with no contributor at all → top-level Unallocated
  months.forEach((m) => {
    rows.push({
      orgId: org.id,
      day: `${m}-20`,
      toolKey: "copilot",
      contributorKey: "unattributed",
      spend: "40",
      tokensTotal: "600000",
      sessions: 1,
    });
  });
  await db.insert(s.aiToolDaily).values(rows);

  console.log("SEEDED", org.id, "contributors:", contribRows.length, "spendRows:", rows.length);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
