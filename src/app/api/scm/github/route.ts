import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  saveGithubPat,
  seedMockGithubPrs,
  syncGithubMergedPrs,
} from "@/lib/scm/github";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });
  const [conn] = await db
    .select()
    .from(s.scmConnections)
    .where(
      and(eq(s.scmConnections.orgId, org.id), eq(s.scmConnections.provider, "github"))
    )
    .limit(1);
  const [{ count }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(s.pullRequests)
    .where(eq(s.pullRequests.orgId, org.id));
  return NextResponse.json({
    connection: conn
      ? {
          id: conn.id,
          status: conn.status,
          accountLogin: conn.accountLogin,
          lastSyncedAt: conn.lastSyncedAt,
          selectedRepos: conn.selectedRepos,
          hasToken: Boolean(conn.credentialsEncrypted),
        }
      : null,
    prCount: Number(count),
  });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });
  const body = (await req.json()) as {
    action: "connect" | "sync" | "demo";
    token?: string;
    repos?: string[];
  };

  try {
    if (body.action === "connect") {
      if (!body.token?.trim()) {
        return NextResponse.json({ error: "token required" }, { status: 400 });
      }
      const conn = await saveGithubPat(org.id, body.token.trim());
      return NextResponse.json({
        ok: true,
        connection: { id: conn.id, status: conn.status },
      });
    }
    if (body.action === "demo") {
      const contributors = await db
        .select({
          id: s.contributors.id,
          githubLogin: s.contributors.githubLogin,
        })
        .from(s.contributors)
        .where(eq(s.contributors.orgId, org.id));
      const result = await seedMockGithubPrs(org.id, contributors, 90);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "sync") {
      const result = await syncGithubMergedPrs(org.id, {
        days: 90,
        repos: body.repos,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
