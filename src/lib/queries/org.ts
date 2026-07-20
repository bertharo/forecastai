import { cookies } from "next/headers";
import { assertDb, db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  ORG_COOKIE,
  parseWorkspaceRegistry,
  WS_REGISTRY_COOKIE,
  type WorkspaceEntry,
} from "@/lib/org/cookie";
import {
  filterValidRegistry,
  verifyWorkspaceAccess,
} from "@/lib/org/access";

export type Org = typeof s.organizations.$inferSelect;

export type PublicOrg = {
  id: string;
  name: string;
  slug: string;
  isPrivate: boolean;
  createdAt: Date;
  sampleDataLoadedAt?: Date | null;
};

export type WorkspaceListItem = PublicOrg & {
  spend30d: number;
  memberCount: number;
  isSample: boolean;
};

const SAMPLE_NAME_RE =
  /sample|demo|northstar|verify|fixture|test\b|playground/i;

function toPublic(org: Org): PublicOrg {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    isPrivate: org.isPrivate,
    createdAt: org.createdAt,
    sampleDataLoadedAt: org.sampleDataLoadedAt ?? null,
  };
}

export function isSampleWorkspace(org: {
  name: string;
  slug: string;
  sampleDataLoadedAt?: Date | null;
}): boolean {
  return (
    Boolean(org.sampleDataLoadedAt) ||
    SAMPLE_NAME_RE.test(org.name) ||
    SAMPLE_NAME_RE.test(org.slug)
  );
}

async function readRegistry(): Promise<WorkspaceEntry[]> {
  const jar = await cookies();
  return parseWorkspaceRegistry(jar.get(WS_REGISTRY_COOKIE)?.value);
}

async function canAccessOrg(
  org: Org,
  registry: WorkspaceEntry[]
): Promise<boolean> {
  if (!org.isPrivate) return true;
  const entry = registry.find((e) => e.id === org.id);
  if (!entry) return false;
  return verifyWorkspaceAccess(entry.id, entry.token);
}

/**
 * Workspaces visible to this browser:
 * - all non-private workspaces
 * - plus private ones claimed in the registry cookie
 */
export async function listOrgs(): Promise<PublicOrg[]> {
  await assertDb();
  const registry = await filterValidRegistry(await readRegistry());
  const privateIds = registry.map((e) => e.id);

  const rows =
    privateIds.length === 0
      ? await db
          .select()
          .from(s.organizations)
          .where(eq(s.organizations.isPrivate, false))
          .orderBy(asc(s.organizations.name))
      : await db
          .select()
          .from(s.organizations)
          .where(
            or(
              eq(s.organizations.isPrivate, false),
              inArray(s.organizations.id, privateIds)
            )
          )
          .orderBy(asc(s.organizations.name));

  return rows.map(toPublic);
}

export async function getOrgById(id: string): Promise<Org | undefined> {
  await assertDb();
  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, id))
    .limit(1);
  return org;
}

export async function getOrgBySlug(slug: string): Promise<Org | undefined> {
  await assertDb();
  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, slug))
    .limit(1);
  return org;
}

/**
 * Resolve the active workspace for this browser.
 * Open workspaces need only the org cookie; private ones need a valid registry token.
 */
export async function getCurrentOrg(_opts?: {
  /** @deprecated Ignored — kept for call-site compatibility. */
  orgParam?: string | null;
}): Promise<PublicOrg | undefined> {
  await assertDb();
  const jar = await cookies();
  const registry = await filterValidRegistry(
    parseWorkspaceRegistry(jar.get(WS_REGISTRY_COOKIE)?.value)
  );
  const preferred = jar.get(ORG_COOKIE)?.value;

  if (preferred) {
    const org = await getOrgById(preferred);
    if (org && (await canAccessOrg(org, registry))) {
      return toPublic(org);
    }
  }

  for (const entry of registry) {
    const org = await getOrgById(entry.id);
    if (org && (await canAccessOrg(org, registry))) {
      return toPublic(org);
    }
  }

  const [open] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.isPrivate, false))
    .orderBy(asc(s.organizations.name))
    .limit(1);
  return open ? toPublic(open) : undefined;
}

/** @deprecated use getCurrentOrg */
export async function getDemoOrg() {
  return getCurrentOrg();
}

export async function getDimensionTypes(orgId: string) {
  return db
    .select()
    .from(s.dimensionTypes)
    .where(eq(s.dimensionTypes.orgId, orgId))
    .orderBy(asc(s.dimensionTypes.sortOrder));
}

export async function getDimensionNodes(orgId: string, dimensionTypeId?: string) {
  const rows = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId))
    .orderBy(asc(s.dimensionNodes.path));
  if (dimensionTypeId) return rows.filter((r) => r.dimensionTypeId === dimensionTypeId);
  return rows;
}

export async function assertBudgetInOrg(budgetId: string, orgId: string) {
  const [row] = await db
    .select({ id: s.budgets.id })
    .from(s.budgets)
    .where(and(eq(s.budgets.id, budgetId), eq(s.budgets.orgId, orgId)))
    .limit(1);
  return !!row;
}

/** Workspaces with 30d spend + roster size for the Workspaces page. */
export async function listWorkspacesWithStats(): Promise<WorkspaceListItem[]> {
  const orgs = await listOrgs();
  if (orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const [spendRows, memberRows, sampleRows] = await Promise.all([
    db
      .select({
        orgId: s.costRecords.orgId,
        spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}), 0)`,
      })
      .from(s.costRecords)
      .where(
        and(
          inArray(s.costRecords.orgId, ids),
          gte(s.costRecords.chargePeriodStart, since)
        )
      )
      .groupBy(s.costRecords.orgId),
    db
      .select({
        orgId: s.contributors.orgId,
        n: sql<number>`count(*)::int`,
      })
      .from(s.contributors)
      .where(inArray(s.contributors.orgId, ids))
      .groupBy(s.contributors.orgId),
    db
      .select({
        id: s.organizations.id,
        sampleDataLoadedAt: s.organizations.sampleDataLoadedAt,
      })
      .from(s.organizations)
      .where(inArray(s.organizations.id, ids)),
  ]);

  const spendBy = new Map(spendRows.map((r) => [r.orgId, Number(r.spend)]));
  const membersBy = new Map(memberRows.map((r) => [r.orgId, Number(r.n)]));
  const sampleBy = new Map(
    sampleRows.map((r) => [r.id, r.sampleDataLoadedAt ?? null])
  );

  return orgs.map((o) => {
    const sampleDataLoadedAt = sampleBy.get(o.id) ?? o.sampleDataLoadedAt ?? null;
    const enriched = { ...o, sampleDataLoadedAt };
    return {
      ...enriched,
      spend30d: spendBy.get(o.id) ?? 0,
      memberCount: membersBy.get(o.id) ?? 0,
      isSample: isSampleWorkspace(enriched),
    };
  });
}
