#!/usr/bin/env node
import pg from "pg";
import { readFile } from "node:fs/promises";

// Deliberately no dotenv, push, data scans, credentials, or automatic application.
// From repo root: pnpm --filter @workspace/db exec node scripts/harden.mjs --verify
const args = process.argv.slice(2);
if (args.length !== 1 || !["--apply", "--verify"].includes(args[0]) || !process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL explicitly and pass exactly --apply or --verify");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
let client;
async function verify(client) {
  const { rows: columns } = await client.query(`
    SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
      pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a
    JOIN pg_class t ON t.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='resource_guards'
      AND t.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
  `);
  const expected = [
    ["user_id", "text"], ["request_window", "timestamp with time zone"], ["request_count", "bigint"],
    ["write_window", "timestamp with time zone"], ["write_count", "bigint"],
  ];
  if (columns.length !== expected.length || columns.some((col, i) => col.name !== expected[i][0] || col.type !== expected[i][1] || !col.required ||
      (col.name.endsWith("_count") && col.default_value !== "0") ||
      (col.name.endsWith("_window") && !/^date_trunc\('minute'::text, statement_timestamp\(\)\)$/.test(col.default_value)))) {
    throw new Error("Guard table shape mismatch");
  }
  const { rows: primary } = await client.query(`
    SELECT array_agg(a.attname::text ORDER BY key.ordinality) AS columns
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum
    WHERE n.nspname=current_schema() AND t.relname='resource_guards' AND c.contype='p'
    GROUP BY c.oid
  `);
  if (primary.length !== 1 || JSON.stringify(primary[0].columns) !== '["user_id"]') throw new Error("Guard primary key mismatch");
  const expectedIndexes = {
    notes_owner_list_idx: ["user_id", "event_date", "created_at", "id"],
    notes_owner_updated_idx: ["user_id", "updated_at", "id"],
  };
  for (const [name, expectedColumns] of Object.entries(expectedIndexes)) {
    const { rows } = await client.query(`
      SELECT t.relname AS table_name, i.indisvalid AS valid, i.indisready AS ready,
        i.indisunique AS unique_index, am.amname AS method,
        i.indpred IS NULL AS unfiltered, i.indexprs IS NULL AS unexpressed,
        i.indnatts AS attribute_count,
        array_agg(a.attname::text ORDER BY key.ordinality) AS columns,
        array_agg(i.indoption[key.ordinality::int-1]::int ORDER BY key.ordinality) AS options
      FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
      JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_am am ON am.oid=idx.relam
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum
      WHERE n.nspname=current_schema() AND idx.relname=$1
      GROUP BY t.relname,i.indexrelid,i.indisvalid,i.indisready,i.indisunique,am.amname,i.indpred,i.indexprs,i.indnatts
    `, [name]);
    const index = rows[0];
    const options = expectedColumns.map((_, i) => i === 0 ? 0 : 3); // DESC defaults NULLS FIRST.
    if (rows.length !== 1 || index.table_name !== "notes" || !index.valid || !index.ready || index.unique_index ||
        index.method !== "btree" || !index.unfiltered || !index.unexpressed || index.attribute_count !== expectedColumns.length ||
        JSON.stringify(index.columns) !== JSON.stringify(expectedColumns) || JSON.stringify(index.options) !== JSON.stringify(options)) {
      throw new Error("Owner index shape mismatch");
    }
  }
  return { verified: true, guardColumns: columns.length, indexes: Object.keys(expectedIndexes).length };
}
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  if (args[0] === "--apply") {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':presenter-notes-hardening',0))");
    await client.query(await readFile(new URL("../migrations/0001_resource_hardening.sql", import.meta.url), "utf8"));
  }
  await verify(client);
  await client.query("COMMIT");
  // Re-read the exact committed catalog targets before reporting success.
  console.log(JSON.stringify(await verify(client)));
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  // Never emit pg connection strings, statements, parameters, or note data.
  console.error(`Hardening ${args[0]} failed; catalog verification or database operation rejected${/^[0-9A-Z]{5}$/.test(error?.code ?? "") ? ` (${error.code})` : ""}`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
