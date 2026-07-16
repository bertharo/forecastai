import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { assignClustersToNode } from "@/lib/allocation/retroactive";

export async function POST(req: Request) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const body = (await req.json()) as {
    match?: Record<string, string>;
    set: Record<string, string>;
  };
  if (!body.set || Object.keys(body.set).length === 0) {
    return NextResponse.json({ error: "set is required" }, { status: 400 });
  }
  try {
    const result = await assignClustersToNode(org.id, {
      match: body.match,
      set: body.set,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
