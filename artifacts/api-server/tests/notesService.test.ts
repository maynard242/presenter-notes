import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@workspace/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../../lib/db/src/schema/notes");
  return { ...schema, db: drizzle({ client: { query } as never, schema }) };
});

import {
  deleteNoteForUser,
  getNoteForUser,
  getStatsForUser,
  listEventsForUser,
  listNotesForUser,
  updateNoteForUser,
} from "../src/lib/notesService";
vi.mock("../src/lib/resourceGuards", () => ({
  checkNoteQuota: vi.fn(),
  withUserWrite: vi.fn(async (_user, fn) => fn((await import("@workspace/db")).db)),
}));

beforeEach(() => query.mockResolvedValue({ rows: [] }));

function lastQuery() {
  const [config, params] = query.mock.calls.at(-1)!;
  return { text: config.text as string, params: params as unknown[] };
}

describe("notes query boundaries", () => {
  it("combines ownership, search and event filters", async () => {
    await listNotesForUser("user-owner", {
      search: "climate",
      event: "Summit",
    });
    const { text, params } = lastQuery();
    expect(text).toContain('"notes"."user_id" = $');
    expect(params).toEqual([
      "user-owner",
      "%climate%",
      "%climate%",
      "%climate%",
      "%Summit%",
      10,
    ]);
    expect(text).toContain(" and ");
  });

  it.each([{}, { search: "AI" }, { event: "Summit" }])(
    "always scopes list queries: %j",
    async (filters) => {
      await listNotesForUser("user-owner", filters);
      expect(lastQuery().text).toContain('"notes"."user_id" = $');
      expect(lastQuery().params[0]).toBe("user-owner");
    },
  );

  it("escapes LIKE wildcards and binds hostile input instead of interpolating SQL", async () => {
    const input = "50%_\\' OR 1=1 --";
    await listNotesForUser("user-owner", {
      search: input,
      event: input,
      limit: 10,
    });
    const { text, params } = lastQuery();
    expect(text).not.toContain(input);
    expect(params).toEqual([
      "user-owner",
      ...Array(4).fill("%50\\%\\_\\\\' OR 1=1 --%"),
      10,
    ]);
  });

  it.each([
    ["get", () => getNoteForUser("user-owner", 42)],
    ["update", () => updateNoteForUser("user-owner", 42, { title: "Updated" })],
    ["delete", () => deleteNoteForUser("user-owner", 42)],
    ["events", () => listEventsForUser("user-owner")],
  ] as const)("scopes %s to the owner", async (_name, run) => {
    await run();
    expect(lastQuery().text).toContain('"notes"."user_id" = $');
    expect(lastQuery().params).toContain("user-owner");
  });

  it("scopes every stats query to the owner", async () => {
    await getStatsForUser("user-owner");
    expect(query).toHaveBeenCalledTimes(4);
    for (const [config, params] of query.mock.calls) {
      expect(config.text).toContain('"notes"."user_id" = $');
      expect(params).toContain("user-owner");
    }
  });
});
