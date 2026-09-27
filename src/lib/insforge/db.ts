import "server-only";
import { Pool } from "pg";

// Singleton pool — survives hot-reload in dev via globalThis.
const POOL_GEN = 2;
const globalForPg = globalThis as unknown as {
  _mosPool?: Pool;
  _mosPoolGen?: number;
  _mosDbDownUntil?: number;
  _mosDbDownLogged?: boolean;
};

export const dbConfigured = Boolean(process.env.DATABASE_URL);

const DOWN_COOLDOWN_MS = 20_000;

export function isDbConnectError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /timeout exceeded when trying to connect|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN|Connection terminated unexpectedly/i.test(
    msg,
  );
}

function noteConnectFailure(e: unknown): void {
  globalForPg._mosDbDownUntil = Date.now() + DOWN_COOLDOWN_MS;
  if (globalForPg._mosDbDownLogged) return;
  globalForPg._mosDbDownLogged = true;
  const msg = e instanceof Error ? e.message : String(e);
  // stderr, not console.error — Next RSC replays console.error as a client overlay.
  process.stderr.write(`[insforge] ${msg}; skipping DB for ${DOWN_COOLDOWN_MS / 1000}s\n`);
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (Insforge Postgres connection).");
  }
  if (!globalForPg._mosPool || globalForPg._mosPoolGen !== POOL_GEN) {
    void globalForPg._mosPool?.end().catch(() => undefined);
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      // Overview fans out channels + snapshots + agent-posts on one tick.
      // max=5 made waiters hit connectionTimeoutMillis and overlay a fake error.
      max: 10,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10_000,
      query_timeout: 8000,
      statement_timeout: 8000,
    });
    pool.on("error", (err) => {
      process.stderr.write(`[insforge] idle client: ${err.message}\n`);
    });
    globalForPg._mosPool = pool;
    globalForPg._mosPoolGen = POOL_GEN;
  }
  return globalForPg._mosPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (Date.now() < (globalForPg._mosDbDownUntil ?? 0)) {
    throw new Error("timeout exceeded when trying to connect");
  }
  try {
    const res = await getPool().query(text, params);
    globalForPg._mosDbDownUntil = 0;
    globalForPg._mosDbDownLogged = false;
    return res.rows as T[];
  } catch (e) {
    if (isDbConnectError(e)) noteConnectFailure(e);
    throw e;
  }
}
