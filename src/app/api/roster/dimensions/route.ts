import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import {
  getPeopleDimensionConfig,
  savePeopleDimensionConfig,
} from "@/lib/roster/dimensions";

export const runtime = "nodejs";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });
  const config = await getPeopleDimensionConfig(org.id);
  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const body = (await req.json()) as {
    columns?: Array<{
      key: string;
      displayName?: string;
      enabled?: boolean;
      role?: "primary" | "secondary" | null;
    }>;
  };

  if (!Array.isArray(body.columns)) {
    return NextResponse.json({ error: "columns array required" }, { status: 400 });
  }

  try {
    const config = await savePeopleDimensionConfig(org.id, { columns: body.columns });
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
