import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, notesTable, type Note } from "@workspace/db";
import { parseFrontmatter } from "./frontmatter";

/** Escape `%` and `_` so they aren't interpreted as ILIKE wildcards. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

const ORDER_BY_RECENT = [
  desc(notesTable.eventDate),
  desc(notesTable.createdAt),
] as const;

export interface ListFilters {
  search?: string;
  event?: string;
  limit?: number;
}

export async function listNotesForUser(
  userId: string,
  filters: ListFilters = {},
): Promise<Note[]> {
  const ownerFilter = eq(notesTable.userId, userId);
  let q = db.select().from(notesTable).$dynamic();

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    q = q.where(
      and(
        ownerFilter,
        or(
          ilike(notesTable.title, pattern),
          ilike(notesTable.event, pattern),
          ilike(notesTable.content, pattern),
        ),
      ),
    );
  } else if (filters.event) {
    q = q.where(
      and(ownerFilter, ilike(notesTable.event, `%${escapeLike(filters.event)}%`)),
    );
  } else {
    q = q.where(ownerFilter);
  }

  q = q.orderBy(...ORDER_BY_RECENT);
  if (filters.limit) q = q.limit(filters.limit);
  return q;
}

export async function searchNotesForUser(
  userId: string,
  query: string,
  limit = 25,
): Promise<Note[]> {
  return listNotesForUser(userId, { search: query, limit });
}

export async function getNoteForUser(
  userId: string,
  id: number,
): Promise<Note | null> {
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
    .orderBy(notesTable.event);
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
      .selectDistinct({ event: notesTable.event })
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
    totalEvents: totalEvents.length,
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
  const [note] = await db
    .insert(notesTable)
    .values({
      userId,
      title: input.title,
      event: input.event,
      content: input.content,
      eventDate: input.eventDate ?? null,
      tags: input.tags ?? [],
      filename: input.filename ?? null,
    })
    .returning();
  return note;
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
    eventDate: overrides.eventDate ?? fm.eventDate ?? null,
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
  const [note] = await db
    .update(notesTable)
    .set(patch)
    .where(and(eq(notesTable.id, id), eq(notesTable.userId, userId)))
    .returning();
  return note ?? null;
}

export async function deleteNoteForUser(
  userId: string,
  id: number,
): Promise<boolean> {
  const [note] = await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, id), eq(notesTable.userId, userId)))
    .returning();
  return !!note;
}
