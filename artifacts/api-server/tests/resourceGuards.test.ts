import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { safeTestDatabaseUrl as safeTestUrl } from "./testDatabase";

const previousDatabaseUrl = process.env.DATABASE_URL;
const rawUrl = process.env.TEST_DATABASE_URL;
const testUrl = rawUrl ? safeTestUrl(rawUrl) : undefined;
const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg");
const schema = `resource_test_${randomUUID().replaceAll("-", "")}`;
let admin: any, pool: any, otherPool: any, db: any, guards: any, otherGuards: any;
let sql: any, notesTable: any;
const scopedUrl = testUrl ? new URL(testUrl) : undefined;
scopedUrl?.searchParams.set("options", `-c search_path=${schema}`);

describe("resource integration URL safety", () => {
  it.each([
    "postgres://postgres@db.example.com/presenter_notes_test",
    "postgres://postgres@127.0.0.1/presenter_notes",
    "postgres://postgres@127.0.0.1/presenter_notes_test?options=-csearch_path=public",
    "https://127.0.0.1/presenter_notes_test",
  ])("refuses unsafe target %s before connecting", value => {
    expect(() => safeTestUrl(value)).toThrow("loopback PostgreSQL");
  });
});

// No DATABASE_URL or credential files are consulted unless this optional suite is enabled.
describe.skipIf(!testUrl)("durable PostgreSQL resource guards", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: testUrl!.toString() });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl!.toString() });
    await pool.query(`CREATE TABLE notes (
      id serial PRIMARY KEY, user_id text NOT NULL, title text NOT NULL, event text NOT NULL,
      event_date text, content text NOT NULL, tags text[] NOT NULL DEFAULT '{}', filename text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migration = await readFile(new URL("../../../lib/db/migrations/0001_resource_hardening.sql", import.meta.url), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    process.env.DATABASE_URL = scopedUrl!.toString();
    ({ sql } = await import("drizzle-orm"));
    const database = await import("@workspace/db");
    db = database.db;
    notesTable = database.notesTable;
    const module = await import("../src/lib/resourceGuards");
    guards = module;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    otherPool = new Pool({ connectionString: scopedUrl!.toString() });
    otherGuards = module.createResourceGuards(drizzle(otherPool));
  });
  afterAll(async () => {
    await otherPool?.end();
    if (guards) await (await import("@workspace/db")).pool.end();
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("never allocates a row for unauthenticated callers", async () => {
    await expect(guards.consumeBudget("", "request")).rejects.toMatchObject({ statusCode: 401 });
    await expect(guards.withUserWrite("", async () => {})).rejects.toMatchObject({ statusCode: 401 });
    expect((await pool.query("SELECT count(*)::int AS n FROM resource_guards WHERE user_id='' ")).rows[0].n).toBe(0);
  });

  it("atomically permits exactly 120 concurrent requests; persists rejected charges", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 130 }, () => guards.consumeBudget("requests", "request")));
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(120);
    const rejected = attempts.filter(x => x.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(10);
    for (const item of rejected) expect(item.reason).toMatchObject({ statusCode: 429, retryAfterSeconds: 60 });
    expect((await pool.query("SELECT request_count FROM resource_guards WHERE user_id='requests'")).rows[0].request_count).toBe("130");
    await expect(otherGuards.consumeBudget("requests", "request")).rejects.toMatchObject({ statusCode: 429 });
  });
  it("keeps one row per user and separates users and request/write budgets", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 25 }, () => guards.consumeBudget("writes", "write")));
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(20);
    await guards.consumeBudget("writes", "request");
    await otherGuards.consumeBudget("another", "write");
    const result = await pool.query("SELECT count(*)::int AS count FROM resource_guards WHERE user_id='writes'");
    expect(result.rows[0].count).toBe(1);
  });
  it("rolls over expired windows with database time, independently", async () => {
    await pool.query("UPDATE resource_guards SET write_window=now()-interval '2 minutes' WHERE user_id='writes'");
    await otherGuards.consumeBudget("writes", "write");
    const { rows } = await pool.query("SELECT write_count,request_count FROM resource_guards WHERE user_id='writes'");
    expect(rows[0]).toMatchObject({ write_count: "1", request_count: "1" });
  });
  it("charges rejected/rolled back writes independently and releases user locks", async () => {
    await expect(guards.withUserWrite("rollback", async (tx: any) => {
      await tx.insert(notesTable).values({ userId: "rollback", title: "t", event: "e", content: "c" });
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    await guards.withUserWrite("rollback", async (tx: any) => {
      expect((await tx.execute(sql`select current_setting('transaction_isolation') as isolation`)).rows[0].isolation).toBe("read committed");
    });
    expect((await pool.query("SELECT count(*)::int AS n FROM notes WHERE user_id='rollback'")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT write_count FROM resource_guards WHERE user_id='rollback'")).rows[0].write_count).toBe("2");
  });
  it("serializes quota checks so only one concurrent last-slot insert succeeds", async () => {
    await pool.query("INSERT INTO notes(user_id,title,event,content) SELECT 'last-slot','t','e','c' FROM generate_series(1,999)");
    const create = () => guards.withUserWrite("last-slot", async (tx: any) => {
      await guards.checkNoteQuota(tx, "last-slot", 0, 3, true);
      await tx.insert(notesTable).values({ userId: "last-slot", title: "t", event: "e", content: "c" });
    });
    const attempts = await Promise.allSettled([create(), create()]);
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect((attempts.find(x => x.status === "rejected") as PromiseRejectedResult).reason.statusCode).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM notes WHERE user_id='last-slot'")).rows[0].n).toBe(1000);
  });
  it("allows non-growing edits for owners already over the note-count quota", async () => {
    await pool.query("INSERT INTO notes(user_id,title,event,content) SELECT 'over-count','t','e','c' FROM generate_series(1,1001)");
    await guards.withUserWrite("over-count", async (tx: any) => {
      await guards.checkNoteQuota(tx, "over-count", 3, 3, false);
      await guards.checkNoteQuota(tx, "over-count", 3, 2, false);
      await expect(guards.checkNoteQuota(tx, "over-count", 0, 1, true)).rejects.toMatchObject({ statusCode: 409 });
    });
  });
  it("counts all UTF-8 text and tags, isolates owners, permits legacy reductions", async () => {
    // Exceed the byte quota through tags/metadata, not content alone.
    await pool.query("INSERT INTO notes(user_id,title,event,content,tags,event_date,filename) VALUES ('legacy','💡','e','c',ARRAY[repeat('x',104857600)],'2026-01-01','f')");
    await guards.withUserWrite("legacy", async (tx: any) => {
      await guards.checkNoteQuota(tx, "legacy", 104857617, 104857616, false);
      await guards.checkNoteQuota(tx, "legacy", 104857617, 104857617, false);
      await expect(guards.checkNoteQuota(tx, "legacy", 104857617, 104857618, false)).rejects.toMatchObject({ statusCode: 409 });
      await expect(guards.checkNoteQuota(tx, "legacy", 0, 3, true)).rejects.toMatchObject({ statusCode: 409 });
    });
    await guards.withUserWrite("clean-owner", async (tx: any) => guards.checkNoteQuota(tx, "clean-owner", 0, 3, true));
  });
  it("runner applies idempotently and verifies exact catalog shape", async () => {
    const runner = new URL("../../../lib/db/scripts/harden.mjs", import.meta.url);
    for (const flag of ["--apply", "--apply", "--verify"]) {
      const result = JSON.parse(execFileSync(process.execPath, [runner.pathname, flag], {
        env: { ...process.env, DATABASE_URL: scopedUrl!.toString() }, encoding: "utf8",
      }));
      expect(result.verified).toBe(true);
      expect(result.guardColumns).toBe(5);
      expect(result.indexes).toBe(2);
    }
    await pool.query("DROP INDEX notes_owner_list_idx; CREATE INDEX notes_owner_list_idx ON notes(user_id)");
    try {
      for (const flag of ["--verify", "--apply"]) {
        const result = spawnSync(process.execPath, [runner.pathname, flag], {
          env: { ...process.env, DATABASE_URL: scopedUrl!.toString() }, encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain(scopedUrl!.toString());
      }
    } finally {
      await pool.query("DROP INDEX notes_owner_list_idx");
      await pool.query(await readFile(new URL("../../../lib/db/migrations/0001_resource_hardening.sql", import.meta.url), "utf8"));
    }
  });
});
