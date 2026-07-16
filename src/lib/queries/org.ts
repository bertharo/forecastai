import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function getDemoOrg() {
  const [org] = await db.select().from(s.organizations).limit(1);
  return org;
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
