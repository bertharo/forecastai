import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, {
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
  max: 1,
  connect_timeout: 30,
});

try {
  await sql.unsafe(`
    ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "people_dimension_config" jsonb
    DEFAULT '{"columns":[],"profiledAt":null,"rowCount":0}'::jsonb
    NOT NULL
  `);
  await sql.unsafe(`
    ALTER TABLE "contributors"
    ADD COLUMN IF NOT EXISTS "attributes" jsonb
    DEFAULT '{}'::jsonb
    NOT NULL
  `);
  const rows = await sql.unsafe(`
    SELECT table_name::text AS t, column_name::text AS c
    FROM information_schema.columns
    WHERE column_name IN ('attributes', 'people_dimension_config')
    ORDER BY 1, 2
  `);
  console.log("OK", JSON.stringify(rows));
} catch (e) {
  console.error("FAIL", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
