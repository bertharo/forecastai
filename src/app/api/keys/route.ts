import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg, getDimensionNodes } from "@/lib/queries/org";
import {
  assignKeyRegistry,
  countUnmappedKeys,
  listKeyRegistry,
} from "@/lib/keys/registry";

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const unmappedOnly =
    req.nextUrl.searchParams.get("unmapped") === "1" ||
    req.nextUrl.searchParams.get("unmapped") === "true";

  const [keys, unmappedCount, nodes] = await Promise.all([
    listKeyRegistry(org.id, { unmappedOnly }),
    countUnmappedKeys(org.id),
    getDimensionNodes(org.id),
  ]);

  return NextResponse.json({
    keys,
    unmappedCount,
    nodes: nodes.map((n) => ({
      id: n.id,
      key: n.key,
      displayName: n.displayName,
      path: n.path,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const body = (await req.json()) as {
    registryId?: string;
    dimensionNodeId?: string | null;
    isServiceAccount?: boolean;
    serviceLabel?: string | null;
    displayName?: string | null;
  };

  if (!body.registryId) {
    return NextResponse.json({ error: "registryId required" }, { status: 400 });
  }

  try {
    const result = await assignKeyRegistry(org.id, {
      registryId: body.registryId,
      dimensionNodeId: body.dimensionNodeId,
      isServiceAccount: body.isServiceAccount,
      serviceLabel: body.serviceLabel,
      displayName: body.displayName,
    });
    const unmappedCount = await countUnmappedKeys(org.id);
    return NextResponse.json({ ok: true, ...result, unmappedCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
