import { describe, expect, it } from "vitest";
import { safeTestDatabaseUrl } from "./testDatabase";

describe("shared integration database target safety", () => {
  it.each([
    "postgres://postgres@remote.example.invalid/presenter_notes_test",
    "postgres://postgres@127.0.0.1/presenter_notes",
    "postgres://postgres@127.0.0.1/presenter_notes_test?host=remote.example.invalid",
    "postgres://postgres@localhost/presenter_notes_test?hostaddr=203.0.113.1",
    "postgres://postgres@127.0.0.1/presenter_notes_test?options=-csearch_path=public",
    "postgres://postgres@127.0.0.1/presenter_notes_test#fragment",
    "postgres://postgres@127.0.0.1/other/presenter_notes_test",
    "https://127.0.0.1/presenter_notes_test",
  ])("rejects unsafe connection overrides before connecting: %s", (value) => {
    expect(() => safeTestDatabaseUrl(value)).toThrow("loopback PostgreSQL");
  });
  it.each([
    "postgres://postgres@127.0.0.1:5432/presenter_notes_test",
    "postgresql://postgres@localhost/presenter_notes_test",
    "postgres://postgres@[::1]/presenter_notes_test",
  ])("permits only explicit loopback test databases: %s", (value) => {
    expect(safeTestDatabaseUrl(value).toString()).toBe(value);
  });
});
