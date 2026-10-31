import { describe, expect, it } from "vitest";
import {
  isCalendarDate,
  validateCreateNote,
  validateUpdateNote,
  validateMarkdownUpload,
  noteSizeBytes,
  NOTE_LIMITS,
} from "../src/lib/noteValidation";

const valid = { title: "Talk", event: "Summit", content: "# Notes" };

describe("shared note input boundary", () => {
  it.each(["2024-02-29", "2025-01-31", "2000-02-29"])("accepts calendar date %s", (date) => {
    expect(isCalendarDate(date)).toBe(true);
    expect(validateCreateNote({ ...valid, eventDate: date }).eventDate).toBe(date);
  });
  it.each(["not-a-date", "2025-02-29", "1900-02-29", "2025-04-31", "2025-13-01", "2025-1-01", "0000-01-01", "2025-01-01T00:00:00Z", ""])("rejects invalid date %s", (date) => {
    expect(isCalendarDate(date)).toBe(false);
    expect(() => validateCreateNote({ ...valid, eventDate: date })).toThrow();
    expect(() => validateUpdateNote({ eventDate: date })).toThrow();
  });
  it("supports clearing dates and omitted optional metadata", () => {
    expect(validateUpdateNote({ eventDate: null })).toEqual({ eventDate: null });
    expect(validateCreateNote(valid)).toEqual(valid);
  });
  it.each([
    { title: " " }, { title: "x".repeat(257) }, { event: "x".repeat(257) },
    { filename: "x".repeat(256) }, { tags: Array(33).fill("tag") },
    { tags: ["x".repeat(65)] }, { tags: [""] },
  ])("rejects unbounded metadata %j", (patch) => {
    expect(() => validateCreateNote({ ...valid, ...patch })).toThrow();
  });
  it("bounds actual UTF-8 bytes, not JS string length", () => {
    expect(validateCreateNote({ ...valid, content: "a".repeat(NOTE_LIMITS.contentBytes) }).content).toHaveLength(NOTE_LIMITS.contentBytes);
    expect(() => validateCreateNote({ ...valid, content: "💡".repeat(NOTE_LIMITS.contentBytes / 4 + 1) })).toThrow();
  });
  it("rejects raw oversized uploads before parsing frontmatter", () => {
    expect(() => validateMarkdownUpload("talk.md", "x".repeat(NOTE_LIMITS.contentBytes + 1))).toThrow();
    expect(() => validateMarkdownUpload("x".repeat(256), "# Note")).toThrow();
  });
  it("rejects empty updates and does not accept ownership injection", () => {
    expect(() => validateUpdateNote({})).toThrow();
    expect(() => validateUpdateNote({ userId: "victim" })).toThrow();
    expect(validateCreateNote({ ...valid, userId: "victim" })).toEqual(valid);
  });
  it("counts all stored note text fields for quotas", () => {
    expect(noteSizeBytes({ title: "a", event: "b", content: "💡", tags: ["c"], eventDate: "2025-01-01", filename: "d" })).toBe(18);
  });
});
