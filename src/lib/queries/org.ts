import { cookies } from "next/headers";
import { assertDb, db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  createdAt: Date;
};

function toPublic(org: Org): PublicOrg {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
  };
}

async function readRegistry(): Promise<WorkspaceEntry[]> {
  const jar = await cookies();
  return parseWorkspaceRegistry(jar.get(WS_REGISTRY_COOKIE)?.value);
}

/** Workspaces this browser owns (registry cookie ∩ valid tokens). */
export async function listOrgs(): Promise<PublicOrg[]> {
  await assertDb();
  const registry = await filterValidRegistry(await readRegistry());
  if (registry.length === 0) return [];

  const ids = registry.map((e) => e.id);
  const rows = await db
    .select()
    .from(s.organizations)
    .where(inArray(s.organizations.id, ids))
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
 * Requires a valid access token in the workspace registry — no cross-workspace fallback.
 */
export async function getCurrentOrg(_opts?: {
  /** @deprecated Ignored — URL org override removed for workspace isolation. */
  orgParam?: string | null;
}): Promise<PublicOrg | undefined> {
  await assertDb();
  const jar = await cookies();
  const registry = await filterValidRegistry(
    parseWorkspaceRegistry(jar.get(WS_REGISTRY_COOKIE)?.value)
  );
  if (registry.length === 0) return undefined;

  const preferred = jar.get(ORG_COOKIE)?.value;
  const entry =
    (preferred && registry.find((e) => e.id === preferred)) || registry[0];

  if (!(await verifyWorkspaceAccess(entry.id, entry.token))) {
    return undefined;
  }

  const org = await getOrgById(entry.id);
  return org ? toPublic(org) : undefined;
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
