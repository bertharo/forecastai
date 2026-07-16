import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { previewOrApplyRule } from "@/lib/allocation/retroactive";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const rules = await db
    .select()
    .from(s.allocationRules)
    .where(eq(s.allocationRules.orgId, org.id))
    .orderBy(asc(s.allocationRules.priority));
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const body = (await req.json()) as {
    name: string;
    match: Record<string, string>;
    set: Record<string, string>;
    priority?: number;
    apply?: boolean;
    preview?: boolean;
  };
  if (!body.name || !body.match || !body.set) {
    return NextResponse.json(
      { error: "name, match, and set are required" },
      { status: 400 }
    );
  }
  try {
    const apply = Boolean(body.apply) && !body.preview;
    const result = await previewOrApplyRule(
      org.id,
      {
        name: body.name,
        match: body.match,
        set: body.set,
        priority: body.priority,
      },
      { apply }
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
