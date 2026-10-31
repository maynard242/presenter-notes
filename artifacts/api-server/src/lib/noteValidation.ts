import { z } from "zod";
import { ServiceError } from "./errors";

export const NOTE_LIMITS = Object.freeze({
  contentBytes: 256 * 1024,
  title: 256,
  event: 256,
  filename: 255,
  tags: 32,
  tag: 64,
});

/** Strict calendar date, not Date's rollover or locale-dependent parser. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const text = (max: number) => z.string().max(max).refine((s) => s.trim().length > 0, "Must not be blank");
const fields = {
  title: text(NOTE_LIMITS.title),
  event: text(NOTE_LIMITS.event),
  eventDate: z.string().refine(isCalendarDate, "Use a valid calendar date (YYYY-MM-DD)").nullable().optional(),
  content: z.string().refine((s) => Buffer.byteLength(s, "utf8") <= NOTE_LIMITS.contentBytes, "Content exceeds 256 KiB"),
  tags: z.array(text(NOTE_LIMITS.tag)).max(NOTE_LIMITS.tags).optional(),
  filename: text(NOTE_LIMITS.filename).nullable().optional(),
};
const createSchema = z.object(fields);
const updateSchema = createSchema.omit({ filename: true }).partial().refine((v) => Object.keys(v).some((key) => v[key as keyof typeof v] !== undefined), "Provide at least one note field");

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  if (value && typeof value === "object" && "content" in value && typeof value.content === "string" && Buffer.byteLength(value.content, "utf8") > NOTE_LIMITS.contentBytes) {
    throw new ServiceError(413, "Markdown content exceeds 256 KiB");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ServiceError(400, `Invalid note ${issue.path.join(".") || "input"}: ${issue.message}`);
  }
  return parsed.data;
}

export function validateCreateNote(value: unknown) { return parseInput(createSchema, value); }
export function validateUpdateNote(value: unknown) { return parseInput(updateSchema, value); }

export function validateMarkdownUpload(filename: string, content: string): void {
  parseInput(z.object({ filename: fields.filename.unwrap().unwrap(), content: fields.content }), { filename, content });
}

export function noteSizeBytes(note: { title: string; event: string; content: string; eventDate?: string | null; tags?: string[]; filename?: string | null }): number {
  return [note.title, note.event, note.content, note.eventDate ?? "", note.filename ?? "", ...(note.tags ?? [])].reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
}
