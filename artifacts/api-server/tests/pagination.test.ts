import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../../lib/db/src/schema/notes");
  return { ...schema, db: drizzle({ client: { query } as never, schema }) };
});
vi.mock("../src/lib/resourceGuards", () => ({
  consumeBudget: vi.fn(), checkNoteQuota: vi.fn(),
  withUserWrite: vi.fn(async (_user, fn) => fn((await import("@workspace/db")).db)),
}));
import { listNoteSummariesForUser, listNotesForUser, createNoteFromMarkdown, updateNoteForUser } from "../src/lib/notesService";

beforeEach(() => query.mockResolvedValue({ rows: [] }));
describe("bounded metadata pagination", () => {
  it("uses SQL preview projection, owner predicates, stable ordering and limit+1", async () => {
    const result = await listNoteSummariesForUser("owner", { search: "AI", event: "Summit", limit: 25, offset: 50 });
    const [config, params] = query.mock.calls.at(-1)!;
    expect(config.text).toContain('left("content", 240)');
    expect(config.text.split(' from "notes"')[0]).not.toContain('"user_id"');
    expect(config.text).toContain('"notes"."user_id" = $');
    expect(config.text).toContain('"notes"."id" desc');
    expect(config.text).toContain("limit $");
    expect(config.text).toContain("offset $");
    expect(params).toEqual(["owner", "%AI%", "%AI%", "%AI%", "%Summit%", 26, 50]);
    expect(result).toEqual({ notes: [], hasMore: false });
  });
  it("never permits an unbounded legacy list", async () => {
    await listNotesForUser("owner");
    expect(query.mock.calls.at(-1)![1]).toContain(10);
  });
  it.each([{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:100001},{search:"x".repeat(257)},{event:"x".repeat(257)}])("rejects invalid filters before SQL: %j", async (filters) => {
    await expect(listNoteSummariesForUser("owner",filters)).rejects.toMatchObject({statusCode:400});
    expect(query).not.toHaveBeenCalled();
  });
  it("validates effective frontmatter and update dates before writes", async () => {
    await expect(createNoteFromMarkdown("owner","talk.md","---\ndate: 2025-02-30\n---\n# Notes")).rejects.toMatchObject({statusCode:400});
    await expect(updateNoteForUser("owner",1,{eventDate:"bad"})).rejects.toMatchObject({statusCode:400});
    expect(query).not.toHaveBeenCalled();
  });
});
