import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, notesTable, type Note } from "@workspace/db";
import { parseFrontmatter } from "./frontmatter";
import { ServiceError } from "./errors";
import { noteSizeBytes, validateCreateNote, validateMarkdownUpload, validateUpdateNote } from "./noteValidation";
import { checkNoteQuota, withUserWrite } from "./resourceGuards";

/** Escape `%` and `_` so they aren't interpreted as ILIKE wildcards. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

const ORDER_BY_RECENT = [
  desc(notesTable.eventDate),
  desc(notesTable.createdAt),
  desc(notesTable.id),
] as const;

export interface ListFilters {
  search?: string;
  event?: string;
  limit?: number;
  offset?: number;
}

function checkedFilters(filters: ListFilters, maximum: number, defaultLimit: number) {
  const limit = filters.limit ?? defaultLimit;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum || !Number.isInteger(offset) || offset < 0 || offset > 100000 ||
      [filters.search, filters.event].some((s) => s !== undefined && (typeof s !== "string" || s.length > 256))) {
    throw new ServiceError(400, "Invalid note pagination or filter");
  }
  return { ...filters, limit, offset };
}

function ownerConditions(userId: string, filters: ListFilters) {
  const conditions = [eq(notesTable.userId, userId)];
  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    conditions.push(or(ilike(notesTable.title, pattern), ilike(notesTable.event, pattern), ilike(notesTable.content, pattern))!);
  }
  if (filters.event) conditions.push(ilike(notesTable.event, `%${escapeLike(filters.event)}%`));
  return and(...conditions);
}

export async function listNotesForUser(
  userId: string,
  filters: ListFilters = {},
): Promise<Note[]> {
  const bounded = checkedFilters(filters, 10, 10);
  return db.select().from(notesTable).where(ownerConditions(userId, bounded))
    .orderBy(...ORDER_BY_RECENT).limit(bounded.limit).offset(bounded.offset);
}

/** Project previews in PostgreSQL: never load full content to build a list. */
export async function listNoteSummariesForUser(userId: string, filters: ListFilters = {}) {
  const bounded = checkedFilters(filters, 100, 25);
  const rows = await db.select({
    id: notesTable.id, title: notesTable.title, event: notesTable.event,
    eventDate: notesTable.eventDate, tags: notesTable.tags, filename: notesTable.filename,
    createdAt: notesTable.createdAt, updatedAt: notesTable.updatedAt,
    preview: sql<string>`left(${notesTable.content}, 240)`,
  }).from(notesTable).where(ownerConditions(userId, bounded))
    .orderBy(...ORDER_BY_RECENT).limit(bounded.limit + 1).offset(bounded.offset);
  return { notes: rows.slice(0, bounded.limit), hasMore: rows.length > bounded.limit };
}

export async function searchNotesForUser(
  userId: string,
  query: string,
  limit = 10,
): Promise<Note[]> {
  return listNotesForUser(userId, { search: query, limit });
}

export async function getNoteForUser(
  userId: string,
  id: number,
): Promise<Note | null> {
  validateNoteId(id);
  const [note] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, id), eq(notesTable.userId, userId)));
  return note ?? null;
}

export async function listEventsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ event: notesTable.event })
    .from(notesTable)
    .where(eq(notesTable.userId, userId))
    .orderBy(notesTable.event)
    .limit(1000);
  return rows.map((r: { event: string }) => r.event);
}

export interface NotesStats {
  totalNotes: number;
  totalEvents: number;
  recentNotes: Note[];
  topEvents: { event: string; count: number }[];
}

export async function getStatsForUser(userId: string): Promise<NotesStats> {
  const ownerFilter = eq(notesTable.userId, userId);
  const [totalNotes, totalEvents, recentNotes, topEvents] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notesTable)
      .where(ownerFilter),
    db
      .select({ count: sql<number>`count(distinct ${notesTable.event})::int` })
      .from(notesTable)
      .where(ownerFilter),
    db
      .select()
      .from(notesTable)
      .where(ownerFilter)
      .orderBy(desc(notesTable.createdAt))
      .limit(5),
    db
      .select({
        event: notesTable.event,
        count: sql<number>`count(*)::int`,
      })
      .from(notesTable)
      .where(ownerFilter)
      .groupBy(notesTable.event)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(5),
  ]);

  return {
    totalNotes: totalNotes[0]?.count ?? 0,
    totalEvents: totalEvents[0]?.count ?? 0,
    recentNotes,
    topEvents,
  };
}

export interface CreateNoteInput {
  title: string;
  event: string;
  content: string;
  eventDate?: string | null;
  tags?: string[];
  filename?: string | null;
}

export async function createNoteForUser(
  userId: string,
  input: CreateNoteInput,
): Promise<Note> {
  const valid = validateCreateNote(input);
  return withUserWrite(userId, async (tx) => {
    await checkNoteQuota(tx, userId, 0, noteSizeBytes(valid), true);
    const [note] = await tx.insert(notesTable).values({ ...valid, userId }).returning();
    return note;
  });
}

export interface UploadOverrides {
  title?: string | null;
  event?: string | null;
  eventDate?: string | null;
  tags?: string[];
}

/**
 * Insert a note from a markdown payload. Frontmatter supplies defaults;
 * `overrides` win when provided.
 */
export async function createNoteFromMarkdown(
  userId: string,
  filename: string,
  content: string,
  overrides: UploadOverrides = {},
): Promise<Note> {
  validateMarkdownUpload(filename, content);
  const fm = parseFrontmatter(content);
  const title =
    overrides.title ??
    fm.title ??
    filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  const event = overrides.event ?? fm.event ?? "Uncategorized";
  const body = fm.body || content;

  return createNoteForUser(userId, {
    title,
    event,
    content: body,
    eventDate: overrides.eventDate !== undefined ? overrides.eventDate : fm.eventDate ?? null,
    tags: overrides.tags ?? fm.tags,
    filename,
  });
}

export async function updateNoteForUser(
  userId: string,
  id: number,
  patch: Partial<{
    title: string;
    event: string;
    eventDate: string | null;
    content: string;
    tags: string[];
  }>,
): Promise<Note | null> {
  validateNoteId(id);
  const valid = validateUpdateNote(patch);
  return withUserWrite(userId, async (tx) => {
    const owner = and(eq(notesTable.id, id), eq(notesTable.userId, userId));
    const [existing] = await tx.select().from(notesTable).where(owner);
    if (!existing) return null;
    await checkNoteQuota(tx, userId, noteSizeBytes(existing), noteSizeBytes({ ...existing, ...valid }), false);
    const [note] = await tx.update(notesTable).set(valid).where(owner).returning();
    return note ?? null;
  });
}

export async function deleteNoteForUser(
  userId: string,
  id: number,
): Promise<boolean> {
  validateNoteId(id);
  return withUserWrite(userId, async (tx) => {
    const [note] = await tx.delete(notesTable)
      .where(and(eq(notesTable.id, id), eq(notesTable.userId, userId)))
      .returning({ id: notesTable.id });
    return !!note;
  });
}

function validateNoteId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new ServiceError(400, "Invalid note id");
}
