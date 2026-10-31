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
  updateNoteForUser: vi.fn(),
}));
vi.mock("../src/lib/notesService", () => service);
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
  app.use(express.json());
  app.use("/api", router);
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
  it.each(["/notes", "/notes/1", "/notes/events", "/notes/stats"])(
    "rejects unauthenticated GET %s",
    async (path) => {
      expect((await fetch(`${base}/api${path}`)).status).toBe(401);
      expect(service.listNotesForUser).not.toHaveBeenCalled();
      expect(service.getNoteForUser).not.toHaveBeenCalled();
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
