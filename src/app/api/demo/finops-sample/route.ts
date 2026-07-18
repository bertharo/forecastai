import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { loadFinopsSamplePack } from "@/lib/demo/finopsSample";

export const maxDuration = 120;

export async function POST() {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No workspace" }, { status: 401 });
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
