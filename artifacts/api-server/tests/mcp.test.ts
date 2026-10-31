import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const service = vi.hoisted(() => ({
  createNoteFromMarkdown: vi.fn(),
  getNoteForUser: vi.fn(),
  listNotesForUser: vi.fn(),
  searchNotesForUser: vi.fn(),
}));
vi.mock("../src/lib/notesService", () => service);
vi.mock("../src/lib/logger", () => ({ logger: { error: vi.fn() } }));

let server: Server;
let base: string;

beforeAll(async () => {
  vi.stubEnv("AGENT_API_KEY", "synthetic-agent-key");
  vi.stubEnv("AGENT_OWNER_USER_ID", "user-agent-owner");
  const { default: router } = await import("../src/mcp");
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

async function rpc(
  method: string,
  params: object = {},
  token: string | null = "synthetic-agent-key",
  suffix = "",
) {
  return fetch(`${base}/api/mcp${suffix}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function result(res: Response) {
  const text = await res.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text);
}

describe("MCP security boundary", () => {
  it.each([null, "wrong-key"])(
    "rejects unauthorized requests: %s",
    async (token) => {
      expect((await rpc("tools/list", {}, token)).status).toBe(401);
      for (const fn of Object.values(service))
        expect(fn).not.toHaveBeenCalled();
    },
  );

  it("does not accept keys in URLs", async () => {
    expect(
      (await rpc("tools/list", {}, null, "?apiKey=synthetic-agent-key")).status,
    ).toBe(401);
  });

  it("initializes the upgraded SDK transport", async () => {
    const res = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "regression-test", version: "1" },
    });
    expect(res.status).toBe(200);
    expect((await result(res)).result.serverInfo.name).toBe("presenter-notes");
  });

  it("exposes only the intended four tools", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(200);
    expect(
      (await result(res)).result.tools
        .map((tool: { name: string }) => tool.name)
        .sort(),
    ).toEqual(["get_note", "list_notes", "search_notes", "upload_note"]);
  });

  it("scopes tool reads to the configured owner", async () => {
    service.getNoteForUser.mockResolvedValue(null);
    const res = await rpc("tools/call", {
      name: "get_note",
      arguments: { id: 42, userId: "user-victim" },
    });
    expect(res.status).toBe(200);
    expect(service.getNoteForUser).toHaveBeenCalledWith("user-agent-owner", 42);
    expect((await result(res)).result.isError).toBe(true);
  });

  it("bounds list results before executing storage queries", async () => {
    const res = await rpc("tools/call", {
      name: "list_notes",
      arguments: { limit: 101 },
    });
    expect(res.status).toBe(200);
    expect((await result(res)).result.isError).toBe(true);
    expect(service.listNotesForUser).not.toHaveBeenCalled();
  });
});
