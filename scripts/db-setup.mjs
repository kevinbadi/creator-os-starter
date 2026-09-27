#!/usr/bin/env node
/**
 * db-setup: create every table the dashboard needs, then seed one channel.
 * Idempotent: if the schema is already there it only tops up the seed.
 *   npm run db:setup        (reads DATABASE_URL from .env.local)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL is not set (copy .env.example to .env.local and fill it in)");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 1 });

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, "..", "db", "schema.sql"), "utf8");

try {
  const { rows } = await pool.query("select to_regclass('channels') is not null as present");
  if (rows[0].present) {
    console.log("• schema already present, skipping create");
  } else {
    await pool.query("begin");
    await pool.query(schema);
    await pool.query("commit");
    const n = (schema.match(/CREATE TABLE/g) || []).length;
    console.log(`✓ created ${n} tables`);
  }
  const { rows: ch } = await pool.query("select count(*)::int as n from channels");
  if (ch[0].n === 0) {
    await pool.query(
      `insert into channels (id, name, type, color, subtitle, position)
       values ('main', 'My Brand', 'personal', '#7AC0FF', 'Your first channel', 0)`,
    );
    console.log("✓ seeded channel 'My Brand' (rename it on the Channels page)");
  }
  console.log("✓ database ready");
} catch (e) {
  await pool.query("rollback").catch(() => {});
  console.error("✗ db setup failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
