import { cookies } from "next/headers";
import { assertDb, db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq, inArray, or } from "drizzle-orm";
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
};

function toPublic(org: Org): PublicOrg {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    isPrivate: org.isPrivate,
    createdAt: org.createdAt,
  };
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
