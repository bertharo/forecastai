import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/meter";

const client = postgres(connectionString, {
  max: 10,
  connect_timeout: 5,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

export const db = drizzle(client, { schema });
export type Db = typeof db;

/** Friendly check used by pages when Postgres may be down. */
export async function assertDb(): Promise<void> {
  try {
    await client`select 1`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Database unavailable (${message}). Start Postgres and run npm run db:setup.`,
      { cause: err }
    );
  }
}
