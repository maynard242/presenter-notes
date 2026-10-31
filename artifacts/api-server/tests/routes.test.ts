import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const service = vi.hoisted(() => ({
  createNoteFromMarkdown: vi.fn(),
  createNoteForUser: vi.fn(),
  deleteNoteForUser: vi.fn(),
  getNoteForUser: vi.fn(),
  getStatsForUser: vi.fn(),
  listEventsForUser: vi.fn(),
  listNotesForUser: vi.fn(),
  listNoteSummariesForUser: vi.fn(),
  updateNoteForUser: vi.fn(),
}));
vi.mock("../src/lib/notesService", () => service);
const budgets = vi.hoisted(() => ({ consumeBudget: vi.fn() }));
vi.mock("../src/lib/resourceGuards", () => budgets);
import { serviceErrorHandler, ServiceError } from "../src/lib/errors";
vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

let server: Server;
let base: string;
const payload = { filename: "synthetic.md", content: "# Test" };

beforeAll(async () => {
  vi.stubEnv("AGENT_API_KEY", "synthetic-agent-key");
  vi.stubEnv("AGENT_OWNER_USER_ID", "user-agent-owner");
  const { default: router } = await import("../src/routes/notes");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", router);
  app.use(serviceErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  vi.unstubAllEnvs();
});

async function upload(
  body: object,
  headers: Record<string, string | undefined> = {},
  suffix = "",
) {
  const requestHeaders = new Headers({ "Content-Type": "application/json" });
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) requestHeaders.set(name, value);
  }
  return fetch(`${base}/api/notes/agent-upload${suffix}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

describe("REST agent authentication", () => {
  it.each([
    { Authorization: "Bearer synthetic-agent-key" },
    { "X-API-Key": "synthetic-agent-key" },
  ])(
    "accepts header authentication without a body key: %j",
    async (headers) => {
      service.createNoteFromMarkdown.mockResolvedValue({ id: 1 });
      const res = await upload(payload, headers);
      expect(res.status).toBe(201);
      expect(service.createNoteFromMarkdown).toHaveBeenCalledWith(
        "user-agent-owner",
        payload.filename,
        payload.content,
        expect.any(Object),
      );
    },
  );

  it("preserves legacy body-key authentication", async () => {
    service.createNoteFromMarkdown.mockResolvedValue({ id: 1 });
    expect(
      (await upload({ ...payload, apiKey: "synthetic-agent-key" })).status,
    ).toBe(201);
  });

  it.each([
    [payload, {}],
    [payload, { Authorization: "Bearer wrong" }],
    [
      { ...payload, apiKey: "synthetic-agent-key" },
      { Authorization: "Bearer wrong" },
    ],
  ])(
    "rejects missing/invalid keys without touching storage",
    async (body, headers) => {
      const res = await upload(body, headers);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
      expect(service.createNoteFromMarkdown).not.toHaveBeenCalled();
    },
  );

  it("does not accept query-string authentication", async () => {
    expect(
      (await upload(payload, {}, "?apiKey=synthetic-agent-key")).status,
    ).toBe(401);
    expect(service.createNoteFromMarkdown).not.toHaveBeenCalled();
  });

  it("never accepts a caller-supplied owner", async () => {
    service.createNoteFromMarkdown.mockResolvedValue({ id: 1 });
    const res = await upload(
      { ...payload, userId: "user-victim" },
      { Authorization: "Bearer synthetic-agent-key" },
    );
    expect(res.status).toBe(201);
    expect(service.createNoteFromMarkdown.mock.calls[0][0]).toBe(
      "user-agent-owner",
    );
  });
});

describe("browser routes", () => {
  it("serves metadata pagination under the session owner", async () => {
    service.listNoteSummariesForUser.mockResolvedValue({ notes: [], hasMore: false });
    const res = await fetch(`${base}/api/notes/page?search=AI&event=Summit&limit=25&offset=25`, { headers: { "x-test-user": "user-session" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [], hasMore: false });
    expect(service.listNoteSummariesForUser).toHaveBeenCalledWith("user-session", { search: "AI", event: "Summit", limit: 25, offset: 25 });
    expect(budgets.consumeBudget).toHaveBeenCalledWith("user-session", "request");
  });
  it.each(["limit=0", "limit=101", "limit=1.2", "offset=-1", "offset=100001", "search=x&search=y", "limit=1&limit=2"])("rejects invalid pagination %s", async (query) => {
    const res = await fetch(`${base}/api/notes/page?${query}`, { headers: { "x-test-user": "user-session" } });
    expect(res.status).toBe(400);
    expect(service.listNoteSummariesForUser).not.toHaveBeenCalled();
  });
  it("returns safe rate-limit errors before reading notes", async () => {
    budgets.consumeBudget.mockRejectedValueOnce(new ServiceError(429, "Request budget exceeded", 60));
    const res = await fetch(`${base}/api/notes/page`, { headers: { "x-test-user": "user-session" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(service.listNoteSummariesForUser).not.toHaveBeenCalled();
  });
  it("returns bounded parser failures without reaching storage", async () => {
    for (const [body, status] of [["{", 400], [JSON.stringify({ content: "x".repeat(1024 * 1024) }), 413]] as const) {
      const res = await fetch(`${base}/api/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      expect(res.status).toBe(status);
      expect((await res.json()).error).not.toContain("SyntaxError");
    }
    expect(budgets.consumeBudget).not.toHaveBeenCalled();
    expect(service.createNoteForUser).not.toHaveBeenCalled();
  });
  it.each(["/notes", "/notes/page", "/notes/1", "/notes/events", "/notes/stats"])(
    "rejects unauthenticated GET %s",
    async (path) => {
      expect((await fetch(`${base}/api${path}`)).status).toBe(401);
      expect(service.listNotesForUser).not.toHaveBeenCalled();
      expect(service.getNoteForUser).not.toHaveBeenCalled();
      expect(budgets.consumeBudget).not.toHaveBeenCalled();
    },
  );

  it("uses session ownership for browser reads", async () => {
    service.getNoteForUser.mockResolvedValue(null);
    const res = await fetch(`${base}/api/notes/42`, {
      headers: { "x-test-user": "user-session" },
    });
    expect(res.status).toBe(404);
    expect(service.getNoteForUser).toHaveBeenCalledWith("user-session", 42);
  });
});
