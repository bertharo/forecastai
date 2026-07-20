/**
 * Parse CSV / Excel (.xls, .xlsx, .xlsm) into the same tabular shape used by imports.
 */
import * as XLSX from "xlsx";
import { parseCsv, parseJsonl, type RawRow, rowsToCsv } from "@/lib/import/parse";

export function isExcelFileName(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
}

export function isJsonlFileName(fileName: string): boolean {
  return /\.jsonl$/i.test(fileName);
}

/** Excel serial date (days since 1899-12-30) → YYYY-MM-DD, or null if out of range. */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  // Token/cost quantities can be large or small; real calendar serials for ~1955–2089 sit here
  if (serial < 20000 || serial > 70000) return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y) return null;
  const y = parsed.y;
  const m = String(parsed.m).padStart(2, "0");
  const d = String(parsed.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS stores Excel calendar days as UTC midnight
    const y = value.getUTCFullYear();
    const m = pad2(value.getUTCMonth() + 1);
    const d = pad2(value.getUTCDate());
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const asDate = excelSerialToIsoDate(value);
    if (asDate) return asDate;
    return String(value);
  }
  const s = String(value).trim();
  // Formatted serial that slipped through as text
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const asDate = excelSerialToIsoDate(Number(s));
    if (asDate) return asDate;
  }
  // Locale short dates from Excel (M/D/YY or M/D/YYYY)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return `${y}-${pad2(Number(us[1]))}-${pad2(Number(us[2]))}`;
  }
  return s;
}

/** First worksheet → headers + string rows. */
export function parseExcelBuffer(
  data: Buffer | Uint8Array | ArrayBuffer
): { headers: string[]; rows: RawRow[] } {
  const buf =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);

  const workbook = XLSX.read(buf, {
    type: "buffer",
    cellDates: true,
    dense: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { headers: [], rows: [] };

  // raw:true so month/date cells stay as Date or Excel serials (not locale strings)
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });
  if (!json.length) {
    // Still try to recover headers from an empty sheet with a header row
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    const headerRow = (aoa[0] ?? []).map((h) => cellToString(h));
    return { headers: headerRow.filter(Boolean), rows: [] };
  }

  const headerSet: string[] = [];
  for (const row of json) {
    for (const key of Object.keys(row)) {
      if (!headerSet.includes(key)) headerSet.push(key);
    }
  }

  const rows: RawRow[] = json.map((obj) => {
    const out: RawRow = {};
    for (const h of headerSet) {
      out[h] = cellToString(obj[h]);
    }
    return out;
  });

  return { headers: headerSet, rows };
}

export function parseExcelBase64(base64: string): { headers: string[]; rows: RawRow[] } {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "").trim();
  const buf = Buffer.from(cleaned, "base64");
  return parseExcelBuffer(buf);
}

/**
 * Unified tabular parse for import APIs.
 * - Excel: pass `base64` (+ fileName)
 * - CSV / text: pass `content`
 * - JSONL: pass `content` with .jsonl name or sourceKind
 */
export function parseTabularUpload(opts: {
  fileName: string;
  content?: string;
  base64?: string;
  sourceKind?: "csv" | "jsonl" | "invoice" | "excel";
}): { headers: string[]; rows: RawRow[]; format: "csv" | "jsonl" | "excel" } {
  const name = opts.fileName || "";

  if (opts.base64 || isExcelFileName(name) || opts.sourceKind === "excel") {
    if (!opts.base64) {
      throw new Error("Excel upload requires base64 file bytes");
    }
    const parsed = parseExcelBase64(opts.base64);
    return { ...parsed, format: "excel" };
  }

  if (!opts.content?.trim()) {
    throw new Error("file content required");
  }

  if (isJsonlFileName(name) || opts.sourceKind === "jsonl") {
    return { ...parseJsonl(opts.content), format: "jsonl" };
  }

  return { ...parseCsv(opts.content), format: "csv" };
}

// re-export for server callers that historically imported from spreadsheet
export { rowsToCsv };
