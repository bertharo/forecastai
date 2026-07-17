import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function upsertContributor(
  orgId: string,
  input: {
    email: string;
    displayName?: string;
    githubLogin?: string | null;
    githubId?: string | null;
    dimensionNodeId?: string | null;
    externalIds?: Record<string, string>;
  }
) {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("email required");

  const [existing] = await db
    .select()
    .from(s.contributors)
    .where(and(eq(s.contributors.orgId, orgId), eq(s.contributors.email, email)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(s.contributors)
      .set({
        displayName: input.displayName ?? existing.displayName,
        githubLogin: input.githubLogin ?? existing.githubLogin,
        githubId: input.githubId ?? existing.githubId,
        dimensionNodeId: input.dimensionNodeId ?? existing.dimensionNodeId,
        externalIds: {
          ...(existing.externalIds ?? {}),
          ...(input.externalIds ?? {}),
        },
        active: true,
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
      externalIds: input.externalIds ?? {},
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
