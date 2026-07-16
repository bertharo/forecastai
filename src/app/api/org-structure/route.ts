import { NextResponse } from "next/server";
import { getCurrentOrg, getDimensionNodes, getDimensionTypes } from "@/lib/queries/org";
import { parseCsv, contentHash } from "@/lib/import/parse";
import {
  defaultOrgStructureMap,
  executeOrgStructureImport,
  mapOrgRows,
  previewOrgStructure,
  ORG_STRUCTURE_ADAPTER_CONTRACT,
  ensureOrgStructureTemplate,
} from "@/lib/import/org-structure";

export async function GET() {
  await ensureOrgStructureTemplate();
  return NextResponse.json({
    adapterContract: ORG_STRUCTURE_ADAPTER_CONTRACT,
    defaultMap: defaultOrgStructureMap(),
    sampleCsv: [
      "node_name,parent_name,dimension_type,cost_center_code,owner_email,node_key",
      "Product,,business_unit,,,product",
      "Product Engineering,Product,department,,,product-eng",
      "Support,Product Engineering,team,CC-220,support@example.com,support",
    ].join("\n"),
  });
}

export async function POST(req: Request) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }

  const body = (await req.json()) as {
    action: "preview" | "import";
    csv: string;
    columnMap?: Record<string, string>;
  };

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: "csv required" }, { status: 400 });
  }

  const { rows } = parseCsv(body.csv);
  const columnMap = body.columnMap ?? defaultOrgStructureMap();
  const mapped = mapOrgRows(rows, columnMap);
  const types = await getDimensionTypes(org.id);
  const nodes = await getDimensionNodes(org.id);
  const preview = previewOrgStructure(
    mapped,
    nodes.map((n) => ({
      id: n.id,
      key: n.key,
      displayName: n.displayName,
      dimensionTypeId: n.dimensionTypeId,
      parentId: n.parentId,
      path: n.path,
      costCenterCode: n.costCenterCode,
      ownerEmail: n.ownerEmail,
    })),
    types.map((t) => t.key)
  );

  if (body.action === "preview" || !body.action) {
    return NextResponse.json({
      ...preview,
      contentHash: contentHash(body.csv),
      rowCount: mapped.length,
    });
  }

  if (!preview.ok) {
    return NextResponse.json(
      { error: "Validation failed", ...preview },
      { status: 400 }
    );
  }

  const result = await executeOrgStructureImport(org.id, preview);
  return NextResponse.json({ ok: true, ...result, preview });
}
