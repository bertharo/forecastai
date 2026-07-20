/** Browser helpers for CSV + Excel uploads (no Node / xlsx deps). */

export function isExcelFileName(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
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
