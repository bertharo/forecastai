import { createHash, randomBytes } from "crypto";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import type { WorkspaceEntry } from "@/lib/org/cookie";

export function hashWorkspaceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintWorkspaceToken(): string {
  return `ws_${randomBytes(24).toString("hex")}`;
}

export async function verifyWorkspaceAccess(
  orgId: string,
  token: string | undefined
): Promise<boolean> {
  if (!token) return false;
  const [org] = await db
    .select({ accessTokenHash: s.organizations.accessTokenHash })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);
  if (!org?.accessTokenHash) return false;
  return org.accessTokenHash === hashWorkspaceToken(token);
}

export async function findOrgByAccessToken(token: string) {
  const hash = hashWorkspaceToken(token);
  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.accessTokenHash, hash))
    .limit(1);
  return org;
}

/** Entries from the browser registry that still verify against the DB. */
export async function filterValidRegistry(
  entries: WorkspaceEntry[]
): Promise<WorkspaceEntry[]> {
  const valid: WorkspaceEntry[] = [];
  for (const e of entries) {
    if (await verifyWorkspaceAccess(e.id, e.token)) valid.push(e);
  }
  return valid;
}
