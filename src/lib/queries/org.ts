import { cookies } from "next/headers";
import { assertDb, db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ORG_COOKIE } from "@/lib/org/cookie";

export type Org = typeof s.organizations.$inferSelect;

export async function listOrgs(): Promise<Org[]> {
  await assertDb();
  return db.select().from(s.organizations).orderBy(asc(s.organizations.name));
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

/** Resolve org from cookie, then slug/id query, then first org. */
export async function getCurrentOrg(opts?: {
  orgParam?: string | null;
}): Promise<Org | undefined> {
  await assertDb();
  const jar = await cookies();
  const cookieVal = jar.get(ORG_COOKIE)?.value;
  const preferred = opts?.orgParam || cookieVal;

  if (preferred) {
    const byId = await getOrgById(preferred);
    if (byId) return byId;
    const bySlug = await getOrgBySlug(preferred);
    if (bySlug) return bySlug;
  }

  const [first] = await db.select().from(s.organizations).limit(1);
  return first;
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
