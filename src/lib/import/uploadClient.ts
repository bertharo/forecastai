/** Browser helpers for CSV + Excel uploads (no Node / xlsx deps). */

export type RawRow = Record<string, string>;

export function isExcelFileName(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
}

/**
 * KEEP IN SYNC with parseCsv in src/lib/import/parse.ts — this is a
 * deliberate duplicate (not a shared import) because parse.ts also exports
 * contentHash/rowContentHash via Node's `crypto`, which would break a
 * client bundle. Drift between the two silently breaks whole-file dedup
 * (see computeContentHash below), since the client and server would then
 * canonicalize the same file differently.
 */
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

/** Browser-native SHA-256 (Web Crypto) — matches Node's createHash("sha256") for identical input bytes. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mirrors the server's contentHash(rowsToCsv(headers, rows)) exactly — see parse.ts. */
export async function computeContentHash(headers: string[], rows: RawRow[]): Promise<string> {
  return sha256Hex(rowsToCsv(headers, rows));
}

/**
 * Splits rows into chunks capped by *serialized byte size*, not a fixed row
 * count — a fixed row count silently breaks down for wide real-world CSVs
 * (many columns, long values): a fixed 2000-row chunk that's fine for a
 * narrow 6-column export can still exceed the platform's request-size limit
 * for a wider one. maxBytes defaults to 500KB, ~9x headroom under Vercel's
 * ~4.5MB request body ceiling even after JSON-string escaping overhead.
 */
export function chunkRowsByBytes(
  headers: string[],
  rows: RawRow[],
  maxBytes = 500_000
): RawRow[][] {
  const chunks: RawRow[][] = [];
  let current: RawRow[] = [];
  let currentBytes = 0;
  for (const row of rows) {
    const rowBytes = rowsToCsv(headers, [row]).length + 1;
    if (current.length > 0 && currentBytes + rowBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += rowBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Rebuild CSV text from rows (preview paste / client hashing). */
export function rowsToCsv(
  headers: string[],
  rows: Record<string, string>[]
): string {
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

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type UploadPayload = {
  fileName: string;
  content?: string;
  base64?: string;
};

export async function readUploadPayload(file: File): Promise<UploadPayload> {
  if (isExcelFileName(file.name)) {
    const buf = await file.arrayBuffer();
    return {
      fileName: file.name,
      base64: arrayBufferToBase64(buf),
    };
  }
  return {
    fileName: file.name,
    content: await file.text(),
  };
}

/**
 * Platform request-size limits (e.g. Vercel's serverless body cap) reject an
 * oversized upload before our route handler runs, returning a plain-text
 * error instead of JSON — `res.json()` then throws a confusing
 * "Unexpected token … is not valid JSON". Parse as text first so we can
 * surface an actionable message instead.
 */
export async function safeJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error(
        "This file is too large for a single upload. Try splitting it into smaller files (e.g. by month) and uploading each separately."
      );
    }
    throw new Error(
      `Upload failed — the server returned an unexpected response (HTTP ${res.status}).`
    );
  }
}
