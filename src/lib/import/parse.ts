import { createHash } from "crypto";

export type RawRow = Record<string, string>;

/** Minimal CSV parser (quoted fields, commas). */
export function parseCsv(text: string): { headers: string[]; rows: RawRow[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows: RawRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseLine(line);
    const row: RawRow = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function parseJsonl(text: string): { headers: string[]; rows: RawRow[] } {
  const rows: RawRow[] = [];
  const headerSet = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line) as Record<string, unknown>;
    const row: RawRow = {};
    for (const [k, v] of Object.entries(obj)) {
      headerSet.add(k);
      row[k] = v == null ? "" : String(v);
    }
    rows.push(row);
  }
  return { headers: [...headerSet], rows };
}

export function contentHash(buf: string | Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function rowContentHash(orgId: string, parts: string[]): string {
  return createHash("sha256").update([orgId, ...parts].join("|")).digest("hex");
}

/** Target fields the mapper can bind to */
export const IMPORT_TARGETS = [
  { key: "timestamp", label: "Timestamp", required: true },
  { key: "provider", label: "Provider", required: true },
  { key: "model", label: "Model / SKU", required: false },
  { key: "meter", label: "Meter", required: false },
  { key: "quantity", label: "Quantity", required: true },
  { key: "cost", label: "Cost (USD)", required: false },
  { key: "tags.email", label: "Tag: email (roster join)", required: false },
  { key: "tags.feature", label: "Tag: feature", required: false },
  { key: "tags.team", label: "Tag: team", required: false },
  { key: "tags.environment", label: "Tag: environment", required: false },
  { key: "tags.api_key", label: "Tag: api_key", required: false },
  { key: "tags.seat_status", label: "Tag: seat_status", required: false },
] as const;

export type ColumnMap = Record<string, string>;

/** Resolve mapped value; `_literal:x` style sources. Case-insensitive headers. */
export function mappedValue(row: RawRow, source: string | undefined): string {
  if (!source) return "";
  if (source.startsWith("_literal:")) return source.slice("_literal:".length);
  if (Object.prototype.hasOwnProperty.call(row, source) && row[source] !== "") {
    return String(row[source]);
  }
  const norm = (h: string) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s\-_–—−]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  const want = norm(source);
  for (const [k, v] of Object.entries(row)) {
    if (norm(k) === want) return String(v ?? "");
  }
  return "";
}
