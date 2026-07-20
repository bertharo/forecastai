import "dotenv/config";
import * as XLSX from "xlsx";
import { writeFileSync, readFileSync } from "fs";
import { parseExcelBuffer } from "@/lib/import/spreadsheet";
import { importRosterFile } from "@/lib/roster/import";
import { executeUsageImport, listTemplates } from "@/lib/import/execute";
import { TELEMETRY_TEMPLATE } from "@/lib/import/telemetry";
import { db, assertDb } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { wipeWorkspaceForSample, clearSampleFlag } from "@/lib/demo/finopsSample";

async function main() {
  const peopleCsv = readFileSync("fixtures/people-cost-center-chain.csv", "utf8");
  const spendCsv = readFileSync("fixtures/telemetry-spend.csv", "utf8");

  const peopleWb = XLSX.read(peopleCsv, { type: "string" });
  const spendWb = XLSX.read(spendCsv, { type: "string" });

  // Force month column to real Excel date serials (what Excel does to "2026-06")
  {
    const sheet = spendWb.Sheets[spendWb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: false,
      defval: "",
    });
    const headers = Object.keys(rows[0] ?? {});
    const monthKey =
      headers.find((h) => h.toLowerCase() === "month") ?? "month";
    const aoa: unknown[][] = [headers];
    for (const r of rows) {
      aoa.push(
        headers.map((h) => {
          if (h !== monthKey) return r[h];
          const m = String(r[h] ?? "");
          // YYYY-MM → first of month as Date (SheetJS writes serial)
          const match = /^(\d{4})-(\d{2})$/.exec(m);
          if (match) {
            // UTC midnight so SheetJS round-trips as Excel date serials
            return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
          }
          return r[h];
        })
      );
    }
    spendWb.Sheets[spendWb.SheetNames[0]] = XLSX.utils.aoa_to_sheet(aoa);
  }

  const peopleBuf = Buffer.from(
    XLSX.write(peopleWb, { type: "buffer", bookType: "xlsx" })
  );
  const spendBuf = Buffer.from(
    XLSX.write(spendWb, { type: "buffer", bookType: "xlsx" })
  );
  writeFileSync("fixtures/people-cost-center-chain.xlsx", peopleBuf);
  writeFileSync("fixtures/telemetry-spend.xlsx", spendBuf);
  writeFileSync("public/fixtures/people-cost-center-chain.xlsx", peopleBuf);
  writeFileSync("public/fixtures/telemetry-spend.xlsx", spendBuf);

  // Also write legacy .xls
  const peopleXls = Buffer.from(
    XLSX.write(peopleWb, { type: "buffer", bookType: "xls" })
  );
  writeFileSync("fixtures/people-cost-center-chain.xls", peopleXls);

  const parsedPeople = parseExcelBuffer(peopleBuf);
  const parsedSpend = parseExcelBuffer(spendBuf);
  const parsedXls = parseExcelBuffer(peopleXls);
  console.log("people xlsx", parsedPeople.headers, parsedPeople.rows.length);
  console.log("people xls", parsedXls.headers, parsedXls.rows.length);
  console.log("spend xlsx", parsedSpend.headers, parsedSpend.rows.length);
  const monthVals = parsedSpend.rows.map((r) => r.month ?? r.Month ?? "");
  console.log("spend months", monthVals);
  if (monthVals.some((m) => /^\d{5}(\.\d+)?$/.test(String(m)))) {
    console.error("month still Excel serial — excelSerialToIsoDate failed");
    process.exit(1);
  }
  if (monthVals.some((m) => !/^\d{4}-\d{2}-\d{2}$/.test(String(m)))) {
    console.error("expected YYYY-MM-DD month values after Excel date cells");
    process.exit(1);
  }

  await assertDb();
  let [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, "excel-ingest"))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(s.organizations)
      .values({ name: "Excel Ingest", slug: "excel-ingest" })
      .returning();
  }
  await wipeWorkspaceForSample(org.id);
  await clearSampleFlag(org.id);

  const roster = await importRosterFile(org.id, {
    fileName: "people.xlsx",
    base64: peopleBuf.toString("base64"),
  });
  console.log("roster", { upserted: roster.upserted, errors: roster.errors });

  const rosterXls = await importRosterFile(org.id, {
    fileName: "people.xls",
    base64: peopleXls.toString("base64"),
  });
  console.log("roster xls upserted", rosterXls.upserted);

  await listTemplates(org.id);
  const [batch] = await db
    .insert(s.importBatches)
    .values({
      orgId: org.id,
      sourceKind: "csv",
      fileName: "telemetry.xlsx",
      contentHash: "excel-" + Date.now(),
      status: "importing",
      rowCount: parsedSpend.rows.length,
    })
    .returning();

  const spend = await executeUsageImport({
    orgId: org.id,
    batchId: batch.id,
    rows: parsedSpend.rows,
    columnMap: TELEMETRY_TEMPLATE.columnMap,
    sourceKind: "csv",
  });
  console.log("spend", spend);

  if (roster.upserted < 1 || spend.written < 1 || spend.errored) {
    process.exit(1);
  }
  console.log("EXCEL OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
