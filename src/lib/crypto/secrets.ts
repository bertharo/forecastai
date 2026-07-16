import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM helpers for connector credentials.
 * Set METER_CREDENTIALS_KEY to a 32-byte secret (or any string — hashed to 32 bytes).
 */
function keyBytes(): Buffer {
  const raw = process.env.METER_CREDENTIALS_KEY || "meter-dev-only-credentials-key";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): {
  ciphertext: string;
  keyId: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]).toString("base64");
  return { ciphertext: packed, keyId: "v1" };
}

export function decryptSecret(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
