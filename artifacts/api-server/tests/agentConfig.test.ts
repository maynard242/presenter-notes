import { describe, expect, it, vi } from "vitest";
import express from "express";

const service = vi.hoisted(() => ({
  createNoteFromMarkdown: vi.fn(),
  createNoteForUser: vi.fn(),
  deleteNoteForUser: vi.fn(),
  getNoteForUser: vi.fn(),
  getStatsForUser: vi.fn(),
  listEventsForUser: vi.fn(),
  listNotesForUser: vi.fn(),
  updateNoteForUser: vi.fn(),
  searchNotesForUser: vi.fn(),
}));
vi.mock("../src/lib/notesService", () => service);
vi.mock("../src/lib/resourceGuards", () => ({ consumeBudget: vi.fn() }));
vi.mock("../src/lib/logger", () => ({ logger: { error: vi.fn() } }));

it.each([
  { key: "", owner: "user-owner", status: 401 },
  { key: "synthetic-agent-key", owner: "", status: 503 },
])(
  "fails closed for REST configuration: %j",
  async ({ key, owner, status }) => {
    vi.resetModules();
    vi.stubEnv("AGENT_API_KEY", key);
    vi.stubEnv("AGENT_OWNER_USER_ID", owner);
    const { default: router } = await import("../src/routes/notes");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(
        `http://127.0.0.1:${port}/api/notes/agent-upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer synthetic-agent-key",
          },
          body: JSON.stringify({ filename: "synthetic.md", content: "# Test" }),
        },
      );
      expect(res.status).toBe(status);
      expect(service.createNoteFromMarkdown).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  },
);

describe("MCP missing owner", () => {
  it("returns a tool error without accessing notes", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_API_KEY", "synthetic-agent-key");
    vi.stubEnv("AGENT_OWNER_USER_ID", "");
    const { default: router } = await import("../src/mcp");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer synthetic-agent-key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_notes", arguments: {} },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      const data = text.split("\n").find((line) => line.startsWith("data: "))!;
      expect(JSON.parse(data.slice(6)).result.isError).toBe(true);
      expect(service.listNotesForUser).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });
});
