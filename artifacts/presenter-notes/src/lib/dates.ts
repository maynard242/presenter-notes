import { format } from "date-fns";

/** Parse date-only values locally, rejecting JavaScript's calendar rollover. */
export function parseEventDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function formatEventDate(value: string | null | undefined, pattern = "MMMM d, yyyy"): string {
  const date = parseEventDate(value);
  return date ? format(date, pattern) : "Date unavailable";
}

export function getNoteDateGroup(note: { eventDate: string | null; createdAt: string }): string {
  let date = parseEventDate(note.eventDate);
  if (!date && parseEventDate(note.createdAt.slice(0, 10))) {
    // Date-only legacy creation values must also stay in the local calendar.
    date = note.createdAt.length === 10 ? parseEventDate(note.createdAt) : new Date(note.createdAt);
  }
  return date && Number.isFinite(date.getTime()) ? format(date, "MMMM yyyy") : "Undated";
}
