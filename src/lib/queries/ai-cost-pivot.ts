/**
 * Excel-style org-hierarchy pivot over coding-tool spend. Rows come from a
 * level family inferred from the people CSV (see roster/levelFamilies) —
 * each contributor's own attribute values define their path, so no manual
 * org mapping is required. Nodes are scoped by full path, so the same name
 * under two parents stays two nodes.
 */
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  detectLevelFamilies,
  pathForAttributes,
  type LevelFamily,
} from "@/lib/roster/levelFamilies";
import { resolveDashboardPeriod } from "@/lib/queries/period";

export type PivotNode = {
  name: string;
  /** "/Engineering/Platform" — unique node identity */
  path: string;
  spendByMonth: Record<string, number>;
  spend: number;
  users: number;
  /** Synthetic bucket (top-level Unallocated or direct-under-parent) */
  synthetic: boolean;
  children: PivotNode[];
};

export type AiCostPivot = {
  family: LevelFamily;
  familyOptions: { base: string; displayName: string }[];
  /** Ordered YYYY-MM keys, oldest first */
  months: string[];
  totalSpend: number;
  /** Top-level rows (root is implicit) */
  rows: PivotNode[];
};

const PIVOT_MONTHS = 3;

type BuildNode = {
  name: string;
  path: string;
  children: Map<string, BuildNode>;
  /** Spend landing exactly at this node (contributor path ends here) */
  directByMonth: Map<string, number>;
  /** All contributors with spend in this subtree */
  users: Set<string>;
  /** Contributors whose path ends exactly here */
  directUsers: Set<string>;
};

function newNode(name: string, path: string): BuildNode {
  return {
    name,
    path,
    children: new Map(),
    directByMonth: new Map(),
    users: new Set(),
    directUsers: new Set(),
  };
}

function finalize(node: BuildNode, months: string[]): PivotNode {
  const children = [...node.children.values()].map((c) => finalize(c, months));

  const spendByMonth: Record<string, number> = {};
  for (const m of months) spendByMonth[m] = node.directByMonth.get(m) ?? 0;
  for (const c of children) {
    for (const m of months) spendByMonth[m] += c.spendByMonth[m] ?? 0;
  }

  const directTotal = [...node.directByMonth.values()].reduce((a, b) => a + b, 0);
  // Direct spend on a node that also has children gets its own explicit row
  // so child rows always sum to the parent total.
  if (children.length > 0 && directTotal > 0.005) {
    const direct: Record<string, number> = {};
    for (const m of months) direct[m] = node.directByMonth.get(m) ?? 0;
    children.push({
      name: "Unallocated",
      path: `${node.path}/__direct`,
      spendByMonth: direct,
      spend: directTotal,
      users: node.directUsers.size,
      synthetic: true,
      children: [],
    });
  }

  children.sort((a, b) => {
    if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
    return b.spend - a.spend;
  });

  return {
    name: node.name,
    path: node.path,
    spendByMonth,
    spend: Object.values(spendByMonth).reduce((a, b) => a + b, 0),
    users: node.users.size,
    synthetic: false,
    children,
  };
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export async function getAiCostPivot(
  orgId: string,
  opts?: { asOf?: Date; toolKey?: string | null; familyBase?: string | null }
): Promise<AiCostPivot | null> {
  const [orgRow] = await db
    .select({ cfg: s.organizations.peopleDimensionConfig })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);
  if (!orgRow) return null;

  const families = detectLevelFamilies(orgRow.cfg.columns ?? []);
  if (families.length === 0) return null;
  const family =
    families.find((f) => f.base === opts?.familyBase) ?? families[0];

  // Anchor months to the same grain-aware period as the page headline.
  const period = await resolveDashboardPeriod(orgId, 30, opts?.asOf ?? new Date());
  const anchor = new Date(period.end.getTime() - 1);
  const months: string[] = [];
  for (let i = PIVOT_MONTHS - 1; i >= 0; i--) {
    months.push(
      monthKey(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)))
    );
  }
  const from = `${months[0]}-01`;
  const lastMonthEnd = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)
  );
  const to = lastMonthEnd.toISOString().slice(0, 10);

  const filters = [
    eq(s.aiToolDaily.orgId, orgId),
    gte(s.aiToolDaily.day, from),
    lte(s.aiToolDaily.day, to),
  ];
  if (opts?.toolKey) filters.push(eq(s.aiToolDaily.toolKey, opts.toolKey));

  const spendRows = await db
    .select({
      month: sql<string>`to_char(${s.aiToolDaily.day}::date, 'YYYY-MM')`,
      contributorId: s.aiToolDaily.contributorId,
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
    })
    .from(s.aiToolDaily)
    .where(and(...filters))
    .groupBy(sql`1`, s.aiToolDaily.contributorId);

  const contributors = await db
    .select({ id: s.contributors.id, attributes: s.contributors.attributes })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, orgId));
  const attrsById = new Map(contributors.map((c) => [c.id, c.attributes]));

  const root = newNode("All", "");
  const unallocated = newNode("Unallocated", "/__unallocated");

  for (const row of spendRows) {
    const spend = Number(row.spend);
    if (!(spend > 0)) continue;
    const attrs = row.contributorId ? attrsById.get(row.contributorId) : undefined;
    const path = attrs ? pathForAttributes(attrs, family) : [];
    const userId = row.contributorId ?? "__unattributed";

    let node: BuildNode;
    if (path.length === 0) {
      node = unallocated;
      unallocated.users.add(userId);
    } else {
      node = root;
      let pathStr = "";
      for (const segment of path) {
        pathStr += `/${segment}`;
        let child = node.children.get(segment);
        if (!child) {
          child = newNode(segment, pathStr);
          node.children.set(segment, child);
        }
        child.users.add(userId);
        node = child;
      }
    }
    node.directByMonth.set(row.month, (node.directByMonth.get(row.month) ?? 0) + spend);
    node.directUsers.add(userId);
    root.users.add(userId);
  }

  const rows = [...root.children.values()].map((c) => finalize(c, months));
  const unallocFinal = finalize(unallocated, months);
  if (unallocFinal.spend > 0.005) {
    unallocFinal.synthetic = true;
    rows.push(unallocFinal);
  }
  rows.sort((a, b) => {
    if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
    return b.spend - a.spend;
  });

  const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
  if (totalSpend <= 0.005) return null;

  return {
    family,
    familyOptions: families.map((f) => ({ base: f.base, displayName: f.displayName })),
    months,
    totalSpend,
    rows,
  };
}
