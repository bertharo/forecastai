import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { attributesFromLegacyFields } from "@/lib/roster/dimensions";

export type ContributorUpsertInput = {
  email: string;
  displayName?: string;
  githubLogin?: string | null;
  githubId?: string | null;
  dimensionNodeId?: string | null;
  /** Full people-CSV attribute map */
  attributes?: Record<string, string> | null;
  /** @deprecated migrated into attributes */
  department?: string | null;
  /** @deprecated migrated into attributes */
  costCenter?: string | null;
  /** @deprecated migrated into attributes */
  costCenterChain?: Record<string, string> | null;
  /** @deprecated */
  costCenterPath?: string | null;
  employmentStatus?: string | null;
  startedOn?: string | null; // YYYY-MM-DD
  endedOn?: string | null;
  externalIds?: Record<string, string>;
};

export async function upsertContributor(orgId: string, input: ContributorUpsertInput) {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("email required");

  const status = (input.employmentStatus ?? "active").toLowerCase();
  const active = status === "active" || status === "contractor" || status === "leave";

  const [existing] = await db
    .select()
    .from(s.contributors)
    .where(and(eq(s.contributors.orgId, orgId), eq(s.contributors.email, email)))
    .limit(1);

  const attributes =
    input.attributes !== undefined
      ? attributesFromLegacyFields({
          attributes: input.attributes ?? {},
          department: input.department,
          costCenter: input.costCenter,
          costCenterChain: input.costCenterChain,
        })
      : attributesFromLegacyFields({
          attributes: existing?.attributes ?? {},
          department:
            input.department !== undefined ? input.department : existing?.department,
          costCenter:
            input.costCenter !== undefined ? input.costCenter : existing?.costCenter,
          costCenterChain:
            input.costCenterChain !== undefined
              ? input.costCenterChain
              : existing?.costCenterChain,
        });

  // Keep legacy columns populated when attributes carry the familiar keys (sample / scripts)
  const department =
    input.department !== undefined
      ? input.department
      : attributes.department ?? existing?.department ?? null;
  const costCenter =
    input.costCenter !== undefined
      ? input.costCenter
      : attributes.cost_center ?? existing?.costCenter ?? null;

  if (existing) {
    const [updated] = await db
      .update(s.contributors)
      .set({
        displayName: input.displayName ?? existing.displayName,
        githubLogin:
          input.githubLogin !== undefined ? input.githubLogin : existing.githubLogin,
        githubId: input.githubId !== undefined ? input.githubId : existing.githubId,
        dimensionNodeId:
          input.dimensionNodeId !== undefined
            ? input.dimensionNodeId
            : existing.dimensionNodeId,
        department,
        costCenter,
        costCenterChain:
          input.costCenterChain !== undefined
            ? (input.costCenterChain ?? {})
            : existing.costCenterChain,
        costCenterPath:
          input.costCenterPath !== undefined
            ? input.costCenterPath
            : existing.costCenterPath,
        attributes,
        employmentStatus: input.employmentStatus ?? existing.employmentStatus,
        startedOn:
          input.startedOn !== undefined ? input.startedOn : existing.startedOn,
        endedOn: input.endedOn !== undefined ? input.endedOn : existing.endedOn,
        externalIds: {
          ...(existing.externalIds ?? {}),
          ...(input.externalIds ?? {}),
        },
        active,
      })
      .where(eq(s.contributors.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(s.contributors)
    .values({
      orgId,
      email,
      displayName: input.displayName ?? email.split("@")[0],
      githubLogin: input.githubLogin ?? null,
      githubId: input.githubId ?? null,
      dimensionNodeId: input.dimensionNodeId ?? null,
      department: department ?? null,
      costCenter: costCenter ?? null,
      costCenterChain: input.costCenterChain ?? {},
      costCenterPath: input.costCenterPath ?? null,
      attributes,
      employmentStatus: status,
      startedOn: input.startedOn ?? null,
      endedOn: input.endedOn ?? null,
      externalIds: input.externalIds ?? {},
      active,
    })
    .returning();
  return created;
}

export async function findContributorByGithub(orgId: string, login: string) {
  const [row] = await db
    .select()
    .from(s.contributors)
    .where(
      and(
        eq(s.contributors.orgId, orgId),
        eq(s.contributors.githubLogin, login.toLowerCase())
      )
    )
    .limit(1);
  return row;
}
