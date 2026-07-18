import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type ContributorUpsertInput = {
  email: string;
  displayName?: string;
  githubLogin?: string | null;
  githubId?: string | null;
  dimensionNodeId?: string | null;
  department?: string | null;
  costCenter?: string | null;
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

  const patch = {
    displayName: input.displayName,
    githubLogin: input.githubLogin,
    githubId: input.githubId,
    dimensionNodeId: input.dimensionNodeId,
    department: input.department,
    costCenter: input.costCenter,
    employmentStatus: input.employmentStatus,
    startedOn: input.startedOn,
    endedOn: input.endedOn,
  };

  if (existing) {
    const [updated] = await db
      .update(s.contributors)
      .set({
        displayName: patch.displayName ?? existing.displayName,
        githubLogin:
          patch.githubLogin !== undefined ? patch.githubLogin : existing.githubLogin,
        githubId: patch.githubId !== undefined ? patch.githubId : existing.githubId,
        dimensionNodeId:
          patch.dimensionNodeId !== undefined
            ? patch.dimensionNodeId
            : existing.dimensionNodeId,
        department:
          patch.department !== undefined ? patch.department : existing.department,
        costCenter:
          patch.costCenter !== undefined ? patch.costCenter : existing.costCenter,
        employmentStatus: patch.employmentStatus ?? existing.employmentStatus,
        startedOn:
          patch.startedOn !== undefined ? patch.startedOn : existing.startedOn,
        endedOn: patch.endedOn !== undefined ? patch.endedOn : existing.endedOn,
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
      department: input.department ?? null,
      costCenter: input.costCenter ?? null,
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
