import { describe, expect, it } from "vitest";
import { getRecoveredNotesOffset, NOTES_PAGE_SIZE, MAX_NOTES_OFFSET } from "../../presenter-notes/src/lib/notes-pagination";

describe("notes pagination recovery", () => {
  it("matches the generated API defaults and offset bound", () => {
    expect(NOTES_PAGE_SIZE).toBe(25);
    expect(MAX_NOTES_OFFSET).toBe(100000);
  });
  it.each([[0,0,0],[25,0,0],[50,1,50],[25,-1,25],[100000,25,100000]])("recovers offset %i with note count %i to %i", (offset,count,expected) => {
    expect(getRecoveredNotesOffset(offset,count)).toBe(expected);
  });
});
