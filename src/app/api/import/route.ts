import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg } from "@/lib/queries/org";
import {
  contentHash,
  parseCsv,
  parseJsonl,
  type ColumnMap,
} from "@/lib/import/parse";
import {
  executeUsageImport,
  findActiveBatchByHash,
  listTemplates,
} from "@/lib/import/execute";
import { eq, desc, and } from "drizzle-orm";

/** Large CSVs can take minutes — keep the serverless fn alive (Pro); Hobby may still cut the HTTP response. */
export const maxDuration = 300;

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const [templates, batches] = await Promise.all([
    listTemplates(org.id),
    db
      .select()
      .from(s.importBatches)
      .where(eq(s.importBatches.orgId, org.id))
      .orderBy(desc(s.importBatches.createdAt))
      .limit(20),
  ]);
  return NextResponse.json({ templates, batches });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });

  const body = (await req.json()) as {
    action?: "preview" | "import";
    fileName?: string;
    content?: string;
    sourceKind?: "csv" | "jsonl" | "invoice";
    columnMap?: ColumnMap;
    mappingTemplateId?: string | null;
  };

  if (!body.content || !body.fileName) {
    return NextResponse.json({ error: "fileName and content required" }, { status: 400 });
  }

  const [orgMeta] = await db
    .select({ sampleAt: s.organizations.sampleDataLoadedAt })
    .from(s.organizations)
    .where(eq(s.organizations.id, org.id))
    .limit(1);
  if (orgMeta?.sampleAt && body.action === "import") {
    return NextResponse.json(
      {
        error: "sample_active",
        message:
          "Sample data is active in this workspace. Reset to clean sample (or clear sample) before importing CSVs so numbers stay consistent.",
      },
      { status: 409 }
    );
  }

  const sourceKind = body.sourceKind ?? "csv";
  const hash = contentHash(body.content);
  const existing = await findActiveBatchByHash(org.id, hash);
  if (existing && body.action === "import") {
    return NextResponse.json(
      {
        error: "duplicate_file",
        message: "This file was already imported. Rollback the prior batch to re-import.",
        batchId: existing.id,
      },
      { status: 409 }
    );
  }

  const parsed =
    sourceKind === "jsonl" ? parseJsonl(body.content) : parseCsv(body.content);

  if (body.action === "preview" || !body.action) {
    return NextResponse.json({
      headers: parsed.headers,
      preview: parsed.rows.slice(0, 50),
      rowCount: parsed.rows.length,
      contentHash: hash,
      duplicateBatchId: existing?.id ?? null,
    });
  }

  let columnMap = body.columnMap ?? {};
  if (body.mappingTemplateId) {
    const [tpl] = await db
      .select()
      .from(s.mappingTemplates)
      .where(eq(s.mappingTemplates.id, body.mappingTemplateId))
      .limit(1);
    if (tpl) columnMap = { ...tpl.columnMap, ...columnMap };
  }

  const [batch] = await db
    .insert(s.importBatches)
    .values({
      orgId: org.id,
      sourceKind,
      fileName: body.fileName,
      contentHash: hash,
      mappingTemplateId: body.mappingTemplateId || null,
      status: "importing",
      rowCount: parsed.rows.length,
      createdBy: "demo",
    })
    .returning();

  const result = await executeUsageImport({
    orgId: org.id,
    batchId: batch.id,
    rows: parsed.rows,
    columnMap,
    sourceKind,
  });

  await db
    .update(s.importBatches)
    .set({
      status: result.errored && !result.written ? "failed" : "completed",
      rowsWritten: result.written,
      rowsSkipped: result.skipped,
      rowsErrored: result.errored,
      errorReport: result.errors,
    })
    .where(and(eq(s.importBatches.id, batch.id)));

  await db.insert(s.auditLogs).values({
    orgId: org.id,
    actorLabel: "demo",
    action: "import.completed",
    entityType: "import_batch",
    entityId: batch.id,
    after: {
      written: result.written,
      skipped: result.skipped,
      errored: result.errored,
      fileName: body.fileName,
    },
  });

  return NextResponse.json({
    batchId: batch.id,
    ...result,
  });
}
