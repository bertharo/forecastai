/**
 * Backfill access_token_hash for workspaces (esp. after schema add).
 * Northstar gets the known demo token; others get a fresh printed token.
 *
 *   DATABASE_URL=... npx tsx scripts/ensure-workspace-tokens.ts
 */
import "dotenv/config";
import { createHash, randomBytes } from "crypto";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { eq, isNull } from "drizzle-orm";

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function main() {
  const [northstar] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, "northstar"))
    .limit(1);

  if (northstar) {
    await db
      .update(s.organizations)
      .set({ accessTokenHash: hash("ws_demo_northstar") })
      .where(eq(s.organizations.id, northstar.id));
    console.log("Northstar claim token: ws_demo_northstar");
  }

  const missing = await db
    .select()
    .from(s.organizations)
    .where(isNull(s.organizations.accessTokenHash));

  for (const org of missing) {
    if (org.slug === "northstar") continue;
    const token = `ws_${randomBytes(24).toString("hex")}`;
    await db
      .update(s.organizations)
      .set({ accessTokenHash: hash(token) })
      .where(eq(s.organizations.id, org.id));
    console.log(`${org.name} (${org.slug}): ${token}`);
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
