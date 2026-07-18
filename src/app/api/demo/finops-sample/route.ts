import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import {
  clearSampleWorkspace,
  loadFinopsSamplePack,
} from "@/lib/demo/finopsSample";
import { workspaceHasUserImports } from "@/lib/queries/brief";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No workspace" }, { status: 401 });
  }

  let body: { replace?: boolean; action?: "load" | "clear" } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "clear") {
    try {
      await clearSampleWorkspace(org.id);
      return NextResponse.json({ ok: true, cleared: true });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      );
    }
  }

  const hasImports = await workspaceHasUserImports(org.id);
  if (hasImports && !body.replace) {
    return NextResponse.json(
      {
        error: "imports_present",
        message:
          "This workspace has uploaded data. Confirm replace to wipe imports and load the clean sample pack.",
      },
      { status: 409 }
    );
  }

  try {
    const result = await loadFinopsSamplePack(org.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No workspace" }, { status: 401 });
  }
  const [row] = await db
    .select({ at: s.organizations.sampleDataLoadedAt })
    .from(s.organizations)
    .where(eq(s.organizations.id, org.id))
    .limit(1);
  const hasImports = await workspaceHasUserImports(org.id);
  return NextResponse.json({
    sampleDataLoadedAt: row?.at ?? null,
    hasUserImports: hasImports,
    mixed: Boolean(row?.at) && hasImports,
  });
}
