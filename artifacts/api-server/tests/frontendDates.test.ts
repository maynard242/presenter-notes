import { describe, expect, it } from "vitest";
import { formatEventDate, getNoteDateGroup, parseEventDate } from "../../presenter-notes/src/lib/dates";

describe("legacy note dates", () => {
  it.each([null, undefined, "", "not a date", "2024-02-30", "2023-02-29", "2024-13-01", "2024-00-01", "2024-01-00", "2024-1-01", "2024-01-01T00:00:00Z", "0000-01-01"])("rejects invalid event date %s without throwing", (value) => {
    expect(parseEventDate(value)).toBeNull();
    expect(formatEventDate(value)).toBe("Date unavailable");
  });

  it("parses calendar dates as local dates, including leap years and early years", () => {
    for (const value of ["2024-02-29", "2026-01-01", "0099-12-31"]) {
      const date = parseEventDate(value)!;
      expect(date).not.toBeNull();
      expect(date.getFullYear()).toBe(Number(value.slice(0, 4)));
      expect(date.getMonth()).toBe(Number(value.slice(5, 7)) - 1);
      expect(date.getDate()).toBe(Number(value.slice(8, 10)));
    }
    expect(formatEventDate("2026-01-01", "MMM d, yyyy")).toBe("Jan 1, 2026");
  });

  it("does not shift calendar dates in a timezone west of UTC", () => {
    const timezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatEventDate("2026-01-01")).toBe("January 1, 2026");
      expect(getNoteDateGroup({ eventDate: "2026-01-01", createdAt: "invalid" })).toBe("January 2026");
    } finally {
      if (timezone === undefined) delete process.env.TZ;
      else process.env.TZ = timezone;
    }
  });

  it("groups by valid event date, then creation date, then Undated", () => {
    expect(getNoteDateGroup({ eventDate: "2026-03-05", createdAt: "2025-01-01T12:00:00Z" })).toBe("March 2026");
    expect(getNoteDateGroup({ eventDate: "2026-02-30", createdAt: "2025-06-15T12:00:00Z" })).toBe("June 2025");
    expect(getNoteDateGroup({ eventDate: null, createdAt: "2025-06-15" })).toBe("June 2025");
    expect(getNoteDateGroup({ eventDate: "bad", createdAt: "bad" })).toBe("Undated");
    expect(getNoteDateGroup({ eventDate: null, createdAt: "2025-02-30T12:00:00Z" })).toBe("Undated");
    expect(getNoteDateGroup({ eventDate: null, createdAt: "" })).toBe("Undated");
  });
});
