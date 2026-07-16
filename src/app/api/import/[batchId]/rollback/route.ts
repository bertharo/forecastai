import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { rollbackImportBatch } from "@/lib/import/execute";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> }
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const { batchId } = await ctx.params;
  try {
    const result = await rollbackImportBatch(org.id, batchId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
