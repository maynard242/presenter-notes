import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, ilike, or, sql, desc } from "drizzle-orm";
import { db, notesTable } from "@workspace/db";
import {
  ListNotesQueryParams,
  CreateNoteBody,
  GetNoteParams,
  UpdateNoteParams,
  UpdateNoteBody,
  DeleteNoteParams,
  UploadNoteMarkdownBody,
  AgentUploadNoteBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";

function requireAuth(req: any, res: any, next: any): void {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

function parseFrontmatter(raw: string): {
  title: string | null;
  event: string | null;
  eventDate: string | null;
  tags: string[];
  body: string;
} {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(frontmatterRegex);

  if (!match) {
    return { title: null, event: null, eventDate: null, tags: [], body: raw };
  }

  const yamlBlock = match[1];
  const body = match[2];

  const titleMatch = yamlBlock.match(/^title:\s*(.+)$/m);
  const eventMatch = yamlBlock.match(/^event:\s*(.+)$/m);
  const dateMatch = yamlBlock.match(/^(?:date|eventDate):\s*(.+)$/m);
  const tagsMatch = yamlBlock.match(/^tags:\s*\[([^\]]*)\]/m);
  const tagsListMatch = yamlBlock.match(/^tags:\s*\n((?:\s+-\s*.+\n?)+)/m);

  let tags: string[] = [];
  if (tagsMatch) {
    tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean);
  } else if (tagsListMatch) {
    tags = tagsListMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  return {
    title: titleMatch ? titleMatch[1].trim().replace(/^['"]|['"]$/g, "") : null,
    event: eventMatch ? eventMatch[1].trim().replace(/^['"]|['"]$/g, "") : null,
    eventDate: dateMatch ? dateMatch[1].trim().replace(/^['"]|['"]$/g, "") : null,
    tags,
    body: body.trim(),
  };
}

router.get("/notes", requireAuth, async (req, res): Promise<void> => {
  const params = ListNotesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, event } = params.data;

  let query = db.select().from(notesTable).$dynamic();

  if (search) {
    const searchPattern = `%${search}%`;
    query = query.where(
      or(
        ilike(notesTable.title, searchPattern),
        ilike(notesTable.event, searchPattern),
        ilike(notesTable.content, searchPattern),
      ),
    );
  } else if (event) {
    query = query.where(ilike(notesTable.event, `%${event}%`));
  }

  const notes = await query.orderBy(desc(notesTable.eventDate), desc(notesTable.createdAt));
  res.json(notes);
});

router.get("/notes/events", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ event: notesTable.event })
    .from(notesTable)
    .orderBy(notesTable.event);
  res.json({ events: rows.map((r) => r.event) });
});

router.get("/notes/stats", requireAuth, async (_req, res): Promise<void> => {
  const totalNotesResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notesTable);
  const totalEventsResult = await db
    .selectDistinct({ event: notesTable.event })
    .from(notesTable);
  const recentNotes = await db
    .select()
    .from(notesTable)
    .orderBy(desc(notesTable.createdAt))
    .limit(5);
  const topEventsResult = await db
    .select({
      event: notesTable.event,
      count: sql<number>`count(*)::int`,
    })
    .from(notesTable)
    .groupBy(notesTable.event)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(5);

  res.json({
    totalNotes: totalNotesResult[0]?.count ?? 0,
    totalEvents: totalEventsResult.length,
    recentNotes,
    topEvents: topEventsResult,
  });
});

router.post("/notes/upload", requireAuth, async (req, res): Promise<void> => {
  const parsed = UploadNoteMarkdownBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { filename, content } = parsed.data;
  const fm = parseFrontmatter(content);

  const title = fm.title ?? filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  const event = fm.event ?? "Uncategorized";
  const body = fm.body || content;

  const [note] = await db
    .insert(notesTable)
    .values({
      title,
      event,
      eventDate: fm.eventDate ?? null,
      content: body,
      tags: fm.tags,
      filename,
    })
    .returning();

  res.status(201).json(note);
});

router.post("/notes/agent-upload", async (req, res): Promise<void> => {
  const parsed = AgentUploadNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { apiKey, filename, content, title: overrideTitle, event: overrideEvent, eventDate, tags } = parsed.data;

  if (!AGENT_API_KEY || apiKey !== AGENT_API_KEY) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const fm = parseFrontmatter(content);
  const title = overrideTitle ?? fm.title ?? filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  const event = overrideEvent ?? fm.event ?? "Uncategorized";
  const body = fm.body || content;

  const [note] = await db
    .insert(notesTable)
    .values({
      title,
      event,
      eventDate: eventDate ?? fm.eventDate ?? null,
      content: body,
      tags: tags ?? fm.tags,
      filename,
    })
    .returning();

  res.status(201).json(note);
});

router.post("/notes", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [note] = await db
    .insert(notesTable)
    .values({
      ...parsed.data,
      tags: parsed.data.tags ?? [],
      eventDate: parsed.data.eventDate ?? null,
      filename: parsed.data.filename ?? null,
    })
    .returning();

  res.status(201).json(note);
});

router.get("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetNoteParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [note] = await db
    .select()
    .from(notesTable)
    .where(eq(notesTable.id, params.data.id));

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(note);
});

router.patch("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateNoteParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [note] = await db
    .update(notesTable)
    .set(parsed.data)
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(note);
});

router.delete("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteNoteParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [note] = await db
    .delete(notesTable)
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
