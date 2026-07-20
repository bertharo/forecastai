/**
 * Parse CSV / Excel (.xls, .xlsx, .xlsm) into the same tabular shape used by imports.
 */
import * as XLSX from "xlsx";
import { parseCsv, parseJsonl, type RawRow } from "@/lib/import/parse";

export function isExcelFileName(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
}

export function isJsonlFileName(fileName: string): boolean {
  return /\.jsonl$/i.test(fileName);
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Prefer YYYY-MM-DD so month/day telemetry parsers accept it
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
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

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (!json.length) {
    // Still try to recover headers from an empty sheet with a header row
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
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

/** Rebuild CSV text from rows (for hashing / preview paste). */
export function rowsToCsv(headers: string[], rows: RawRow[]): string {
  const esc = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}
