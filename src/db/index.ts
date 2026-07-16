import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/meter";

type Sql = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __meterSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __meterDb: PostgresJsDatabase<typeof schema> | undefined;
}

function createClient(): Sql {
  return postgres(connectionString, {
    max: 5,
    connect_timeout: 5,
    idle_timeout: 10,
    max_lifetime: 60 * 5,
    prepare: false,
  });
}

function getClient(): Sql {
  if (!globalThis.__meterSql) {
    globalThis.__meterSql = createClient();
  }
  return globalThis.__meterSql;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalThis.__meterDb) {
    globalThis.__meterDb = drizzle(getClient(), { schema });
  }
  return globalThis.__meterDb;
}

async function resetPool(): Promise<void> {
  const old = globalThis.__meterSql;
  globalThis.__meterSql = undefined;
  globalThis.__meterDb = undefined;
  if (old) {
    await old.end({ timeout: 1 }).catch(() => undefined);
  }
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /connect|ECONNREFUSED|CONNECTION_ENDED|CONNECTION_DESTROYED|not queryable|timeout|Failed query/i.test(
    msg
  );
}

/** Lazily resolves so a dead pool can be replaced after Postgres restarts. */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

export type Db = PostgresJsDatabase<typeof schema>;

/** Ping DB; recreate the pool once if Postgres was restarted under us. */
export async function assertDb(): Promise<void> {
  try {
    await getClient()`select 1`;
  } catch (err) {
    if (isConnectionError(err)) {
      await resetPool();
      try {
        await getClient()`select 1`;
        return;
      } catch (retryErr) {
        const message =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(
          `Database unavailable (${message}). Start Postgres and run npm run db:setup.`,
          { cause: retryErr }
        );
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Database unavailable (${message}). Start Postgres and run npm run db:setup.`,
      { cause: err }
    );
  }
}
