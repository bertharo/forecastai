import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg } from "@/lib/queries/org";
import { contentHash, type ColumnMap } from "@/lib/import/parse";
import {
  executeUsageImport,
  findActiveBatchByHash,
  listTemplates,
  type ImportError,
} from "@/lib/import/execute";
import { projectCodingToolImportsToAiDaily } from "@/lib/ai-tools/from-import";
import {
  isExcelFileName,
  parseTabularUpload,
  rowsToCsv,
} from "@/lib/import/spreadsheet";
import { eq, desc, and, sql } from "drizzle-orm";

/** Large files / SheetJS need the Node runtime (not Edge). */
export const runtime = "nodejs";
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
  return NextResponse.json({
    templates,
    batches,
    acceptedFormats: [".csv", ".xlsx", ".xls", ".xlsm", ".jsonl"],
  });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });

  const body = (await req.json()) as {
    action?: "preview" | "import" | "checkDuplicate" | "startBatch" | "importChunk" | "finishBatch";
    fileName?: string;
    content?: string;
    base64?: string;
    sourceKind?: "csv" | "jsonl" | "invoice" | "excel";
    columnMap?: ColumnMap;
    mappingTemplateId?: string | null;
    contentHash?: string;
    batchId?: string;
    rowCount?: number;
  };

  // Chunked CSV upload path (see src/app/(app)/import/page.tsx) — none of
  // these send a whole file in the body, so they're handled before the
  // "fileName + content/base64 required" guard below.
  if (body.action === "checkDuplicate") {
    if (!body.contentHash) {
      return NextResponse.json({ error: "contentHash required" }, { status: 400 });
    }
    const existing = await findActiveBatchByHash(org.id, body.contentHash);
    const canRetryPartial =
      !!existing && existing.status === "completed" && (existing.rowsErrored ?? 0) > 0;
    return NextResponse.json({
      duplicateBatchId: existing && !canRetryPartial ? existing.id : null,
    });
  }

  if (body.action === "startBatch") {
    if (!body.fileName || !body.contentHash) {
      return NextResponse.json(
        { error: "fileName and contentHash required" },
        { status: 400 }
      );
    }
    const [orgMeta] = await db
      .select({ sampleAt: s.organizations.sampleDataLoadedAt })
      .from(s.organizations)
      .where(eq(s.organizations.id, org.id))
      .limit(1);
    if (orgMeta?.sampleAt) {
      return NextResponse.json(
        {
          error: "sample_active",
          message:
            "Sample data is active in this workspace. Reset to clean sample (or clear sample) before importing CSVs so numbers stay consistent.",
        },
        { status: 409 }
      );
    }
    const existing = await findActiveBatchByHash(org.id, body.contentHash);
    const canRetryPartial =
      !!existing && existing.status === "completed" && (existing.rowsErrored ?? 0) > 0;
    if (existing && !canRetryPartial) {
      return NextResponse.json(
        {
          error: "duplicate_file",
          message: "This file was already imported. Rollback the prior batch to re-import.",
          batchId: existing.id,
        },
        { status: 409 }
      );
    }
    const chunkSourceKind = body.sourceKind === "invoice" ? "invoice" : "csv";
    const [batch] = await db
      .insert(s.importBatches)
      .values({
        orgId: org.id,
        sourceKind: chunkSourceKind,
        fileName: body.fileName,
        contentHash: body.contentHash,
        mappingTemplateId: body.mappingTemplateId || null,
        status: "importing",
        rowCount: body.rowCount ?? 0,
        createdBy: "demo",
      })
      .returning();
    return NextResponse.json({ batchId: batch.id });
  }

  if (body.action === "importChunk") {
    if (!body.batchId || !body.content) {
      return NextResponse.json(
        { error: "batchId and content required" },
        { status: 400 }
      );
    }
    const [batch] = await db
      .select()
      .from(s.importBatches)
      .where(and(eq(s.importBatches.id, body.batchId), eq(s.importBatches.orgId, org.id)))
      .limit(1);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.status !== "importing") {
      return NextResponse.json(
        { error: `Batch is ${batch.status}, not accepting more rows` },
        { status: 400 }
      );
    }

    const chunkSourceKind = body.sourceKind === "invoice" ? "invoice" : "csv";
    let parsed: { headers: string[]; rows: ReturnType<typeof parseTabularUpload>["rows"] };
    try {
      parsed = parseTabularUpload({
        fileName: batch.fileName,
        content: body.content,
        sourceKind: chunkSourceKind,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 }
      );
    }

    const result = await executeUsageImport({
      orgId: org.id,
      batchId: batch.id,
      rows: parsed.rows,
      columnMap: body.columnMap ?? {},
      sourceKind: chunkSourceKind,
      skipProjection: true,
    });

    await db
      .update(s.importBatches)
      .set({
        rowsWritten: sql`${s.importBatches.rowsWritten} + ${result.written}`,
        rowsSkipped: sql`${s.importBatches.rowsSkipped} + ${result.skipped}`,
        rowsErrored: sql`${s.importBatches.rowsErrored} + ${result.errored}`,
        errorReport: sql`${s.importBatches.errorReport} || ${JSON.stringify(result.errors)}::jsonb`,
      })
      .where(eq(s.importBatches.id, batch.id));

    return NextResponse.json({
      written: result.written,
      skipped: result.skipped,
      errored: result.errored,
    });
  }

  if (body.action === "finishBatch") {
    if (!body.batchId) {
      return NextResponse.json({ error: "batchId required" }, { status: 400 });
    }
    const [batch] = await db
      .select()
      .from(s.importBatches)
      .where(and(eq(s.importBatches.id, body.batchId), eq(s.importBatches.orgId, org.id)))
      .limit(1);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const written = batch.rowsWritten ?? 0;
    const errored = batch.rowsErrored ?? 0;
    const finalStatus = errored > 0 && written === 0 ? "failed" : "completed";

    await db
      .update(s.importBatches)
      .set({ status: finalStatus })
      .where(eq(s.importBatches.id, batch.id));

    if (written > 0) {
      await projectCodingToolImportsToAiDaily(org.id);
    }

    await db.insert(s.auditLogs).values({
      orgId: org.id,
      actorLabel: "demo",
      action: "import.completed",
      entityType: "import_batch",
      entityId: batch.id,
      after: {
        written,
        skipped: batch.rowsSkipped ?? 0,
        errored,
        fileName: batch.fileName,
        format: "csv",
      },
    });

    return NextResponse.json({
      batchId: batch.id,
      status: finalStatus,
      written,
      skipped: batch.rowsSkipped ?? 0,
      errored,
      errors: (batch.errorReport ?? []) as ImportError[],
    });
  }

  if (!body.fileName || (!body.content && !body.base64)) {
    return NextResponse.json(
      { error: "fileName and content (or base64 for Excel) required" },
      { status: 400 }
    );
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

  let parsed: { headers: string[]; rows: ReturnType<typeof parseTabularUpload>["rows"]; format: string };
  try {
    parsed = parseTabularUpload({
      fileName: body.fileName,
      content: body.content,
      base64: body.base64,
      sourceKind:
        body.sourceKind === "excel" || isExcelFileName(body.fileName)
          ? "excel"
          : body.sourceKind === "jsonl"
            ? "jsonl"
            : "csv",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  // Hash stable tabular form so re-saving the same sheet as CSV/XLSX still dedupes
  const canonical = rowsToCsv(parsed.headers, parsed.rows);
  const hash = contentHash(canonical);
  const existing = await findActiveBatchByHash(org.id, hash);
  // Allow retry when a prior import completed with row errors (e.g. missing meters).
  // Already-written rows are skipped via content hash; failed rows get another chance.
  const canRetryPartial =
    !!existing &&
    existing.status === "completed" &&
    (existing.rowsErrored ?? 0) > 0;
  if (existing && body.action === "import" && !canRetryPartial) {
    return NextResponse.json(
      {
        error: "duplicate_file",
        message: "This file was already imported. Rollback the prior batch to re-import.",
        batchId: existing.id,
      },
      { status: 409 }
    );
  }

  const sourceKind: "csv" | "jsonl" | "invoice" =
    body.sourceKind === "invoice"
      ? "invoice"
      : body.sourceKind === "jsonl" || parsed.format === "jsonl"
        ? "jsonl"
        : "csv";

  if (body.action === "preview" || !body.action) {
    return NextResponse.json({
      headers: parsed.headers,
      preview: parsed.rows.slice(0, 50),
      rowCount: parsed.rows.length,
      contentHash: hash,
      duplicateBatchId: existing?.id ?? null,
      format: parsed.format,
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
      format: parsed.format,
    },
  });

  return NextResponse.json({
    batchId: batch.id,
    format: parsed.format,
    ...result,
  });
}
