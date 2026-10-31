import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serviceErrorHandler } from "../src/lib/errors";
import { safeTestDatabaseUrl } from "./testDatabase";

// No Clerk sessions or production data: the auth adapter alone is synthetic.
vi.mock("@clerk/express", () => ({ getAuth: (req: express.Request) => ({ userId: req.headers["x-test-user"] ?? null }) }));
vi.mock("../src/lib/logger", () => ({ logger: { error: vi.fn() } }));
const testUrl = process.env.TEST_DATABASE_URL;
const schema = `notes_integration_${randomUUID().replaceAll("-", "")}`;
const root = fileURLToPath(new URL("../../../", import.meta.url));
let database: typeof import("@workspace/db");
let service: typeof import("../src/lib/notesService");
let server: Server;
let base: string;
const owner = () => `synthetic-${randomUUID()}`;
const noteInput = { title: "Talk", event: "Summit", content: "# Talking points", eventDate: "2024-02-29", tags: ["AI"] };

// Opt-in only; validate BEFORE importing the database module or executing SQL.
describe.skipIf(!testUrl)("real PostgreSQL notes / REST / MCP integration", () => {
  beforeAll(async () => {
    const url = safeTestDatabaseUrl(testUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("AGENT_API_KEY", "synthetic-integration-key");
    vi.stubEnv("AGENT_OWNER_USER_ID", "synthetic-agent-owner");
    database = await import("@workspace/db");
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    await database.pool.query(`CREATE TABLE ${schema}.notes (
      id serial PRIMARY KEY, user_id text NOT NULL, title text NOT NULL, event text NOT NULL,
      event_date text, content text NOT NULL, tags text[] NOT NULL DEFAULT '{}', filename text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    try {
      execFileSync(process.execPath, ["lib/db/scripts/harden.mjs", "--apply"], { cwd: root, env: process.env, stdio: "pipe" });
      execFileSync(process.execPath, ["lib/db/scripts/harden.mjs", "--verify"], { cwd: root, env: process.env, stdio: "pipe" });
    } catch { throw new Error("Isolated hardening migration failed (connection/output withheld)"); }
    service = await import("../src/lib/notesService");
    const { default: notesRouter } = await import("../src/routes/notes");
    const { default: mcpRouter } = await import("../src/mcp");
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", notesRouter);
    app.use("/api", mcpRouter);
    app.use(serviceErrorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  }, 30000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (database) {
      await database.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await database.pool.end();
    }
    vi.unstubAllEnvs();
  });

  it("roundtrips create/update/delete, date clearing and owner isolation through PostgreSQL", async () => {
    const user = owner();
    const note = await service.createNoteForUser(user,noteInput);
    expect(note.eventDate).toBe("2024-02-29");
    expect(await service.getNoteForUser(owner(),note.id)).toBeNull();
    expect(await service.updateNoteForUser(owner(),note.id,{title:"Forbidden"})).toBeNull();
    expect(await service.deleteNoteForUser(owner(),note.id)).toBe(false);
    const updated = await service.updateNoteForUser(user,note.id,{eventDate:null,content:"Revised"});
    expect(updated).toMatchObject({eventDate:null,content:"Revised",title:"Talk"});
    expect(await service.deleteNoteForUser(user,note.id)).toBe(true);
    expect(await service.getNoteForUser(user,note.id)).toBeNull();
  });

  it("pages deterministically with exact hasMore, combined escaped filters and SQL-only previews", async () => {
    const user = owner();
    const values = Array.from({length:26}, (_,index) => ({...noteInput,userId:user,title:`Talk ${index}`,content:`AI ${"文".repeat(300)}`}));
    await database.db.insert(database.notesTable).values(values);
    await database.db.insert(database.notesTable).values({...noteInput,userId:owner()});
    const first = await service.listNoteSummariesForUser(user,{search:"AI",event:"Summit",limit:25});
    const second = await service.listNoteSummariesForUser(user,{search:"AI",event:"Summit",limit:25,offset:25});
    expect(first.notes).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(second.notes).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    const ids = [...first.notes,...second.notes].map(note=>note.id);
    expect(new Set(ids).size).toBe(26);
    expect(ids).toEqual([...ids].sort((a,b)=>b-a));
    expect(Array.from(first.notes[0].preview)).toHaveLength(240);
    expect(first.notes[0]).not.toHaveProperty("content");
    expect(first.notes[0]).not.toHaveProperty("userId");
    expect((await service.listNotesForUser(user))).toHaveLength(10);
    expect((await service.listNoteSummariesForUser(user,{search:"%"})).notes).toHaveLength(0);
    expect((await service.listNoteSummariesForUser(user,{event:"No event"})).notes).toHaveLength(0);
  });

  it("enforces effective frontmatter and multibyte byte limits, without changing legacy invalid dates", async () => {
    const user = owner();
    await expect(service.createNoteFromMarkdown(user,"invalid.md","---\ndate: 2025-02-30\n---\nBody")).rejects.toMatchObject({statusCode:400});
    await expect(service.createNoteForUser(user,{...noteInput,content:"文".repeat(90000)})).rejects.toMatchObject({statusCode:413});
    const [legacy] = await database.db.insert(database.notesTable).values({...noteInput,userId:user,eventDate:"legacy-invalid"}).returning();
    expect((await service.getNoteForUser(user,legacy.id))?.eventDate).toBe("legacy-invalid");
    expect((await service.updateNoteForUser(user,legacy.id,{title:"Repair in stages"}))?.eventDate).toBe("legacy-invalid");
    expect((await service.updateNoteForUser(user,legacy.id,{eventDate:"2024-02-29"}))?.eventDate).toBe("2024-02-29");
    const cleared = await service.createNoteFromMarkdown(user,"clear.md","---\ndate: invalid\n---\nBody",{eventDate:null});
    expect(cleared.eventDate).toBeNull();
  });

  it("serializes concurrent last-slot service inserts, then permits deletion/retry", async () => {
    const user = owner();
    await database.db.insert(database.notesTable).values(Array.from({length:999},()=>({...noteInput,userId:user})));
    const results = await Promise.allSettled([service.createNoteForUser(user,noteInput),service.createNoteForUser(user,noteInput)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const rejected = results.find(r=>r.status==="rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({statusCode:409});
    expect((await service.getStatsForUser(user)).totalNotes).toBe(1000);
    const inserted = (results.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof service.createNoteForUser>>>).value;
    await service.deleteNoteForUser(user,inserted.id);
    expect(await service.createNoteForUser(user,noteInput)).toBeDefined();
  });

  it("executes authenticated REST and MCP against the real owner-scoped database", async () => {
    const headers = {"Content-Type":"application/json",Authorization:"Bearer synthetic-integration-key"};
    const upload = await fetch(`${base}/api/notes/agent-upload`,{method:"POST",headers,body:JSON.stringify({filename:"talk.md",content:"# Real synthetic DB",eventDate:"2024-02-29"})});
    expect(upload.status).toBe(201);
    const created = await upload.json();
    expect(created.userId).toBe("synthetic-agent-owner");
    const page = await fetch(`${base}/api/notes/page`,{headers:{"x-test-user":"synthetic-agent-owner"}});
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body.notes.map((note:{id:number})=>note.id)).toContain(created.id);
    expect(body.notes[0]).not.toHaveProperty("content");
    const rpc = await fetch(`${base}/api/mcp`,{method:"POST",headers:{...headers,Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"get_note",arguments:{id:created.id}}})});
    expect(rpc.status).toBe(200);
    const text = await rpc.text();
    const response = JSON.parse(text.split("\n").find(line=>line.startsWith("data: "))!.slice(6));
    expect(JSON.parse(response.result.content[0].text)).toMatchObject({id:created.id,content:"# Real synthetic DB"});
    const other = await fetch(`${base}/api/notes/${created.id}`,{headers:{"x-test-user":owner()}});
    expect(other.status).toBe(404);
    const invalid = await fetch(`${base}/api/notes/agent-upload`,{method:"POST",headers,body:JSON.stringify({filename:"bad.md",content:"---\ndate: bad\n---\nBody"})});
    expect(invalid.status).toBe(400);
  });
});
