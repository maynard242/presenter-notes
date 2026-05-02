import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getAuth } from "@clerk/express";
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
import { checkAgentApiKey } from "../lib/agentAuth";
import {
  createNoteForUser,
  createNoteFromMarkdown,
  deleteNoteForUser,
  getNoteForUser,
  getStatsForUser,
  listEventsForUser,
  listNotesForUser,
  updateNoteForUser,
} from "../lib/notesService";

const router: IRouter = Router();

const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";
const AGENT_OWNER_USER_ID = process.env.AGENT_OWNER_USER_ID ?? "";

interface AuthedRequest extends Request {
  userId: string;
}

function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).userId = userId;
  next();
}

router.get("/notes", requireAuth, async (req, res): Promise<void> => {
  const params = ListNotesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const notes = await listNotesForUser(userId, params.data);
  res.json(notes);
});

router.get("/notes/events", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthedRequest;
  const events = await listEventsForUser(userId);
  res.json({ events });
});

router.get("/notes/stats", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthedRequest;
  const stats = await getStatsForUser(userId);
  res.json(stats);
});

router.post("/notes/upload", requireAuth, async (req, res): Promise<void> => {
  const parsed = UploadNoteMarkdownBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const note = await createNoteFromMarkdown(
    userId,
    parsed.data.filename,
    parsed.data.content,
  );
  res.status(201).json(note);
});

router.post("/notes/agent-upload", async (req, res): Promise<void> => {
  const parsed = AgentUploadNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Prefer header auth (Authorization: Bearer / X-API-Key). Body apiKey is
  // accepted for backward compatibility with existing curl callers, but
  // header auth is preferred — body fields leak into request-body logs.
  if (!checkAgentApiKey(req, AGENT_API_KEY, parsed.data.apiKey)) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="presenter-notes"')
      .json({ error: "Invalid API key" });
    return;
  }

  if (!AGENT_OWNER_USER_ID) {
    res.status(503).json({ error: "Agent owner not configured" });
    return;
  }

  const { filename, content, title, event, eventDate, tags } = parsed.data;
  const note = await createNoteFromMarkdown(
    AGENT_OWNER_USER_ID,
    filename,
    content,
    { title, event, eventDate, tags },
  );
  res.status(201).json(note);
});

router.post("/notes", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const note = await createNoteForUser(userId, {
    title: parsed.data.title,
    event: parsed.data.event,
    content: parsed.data.content,
    eventDate: parsed.data.eventDate,
    tags: parsed.data.tags,
    filename: parsed.data.filename,
  });
  res.status(201).json(note);
});

router.get("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetNoteParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const note = await getNoteForUser(userId, params.data.id);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.json(note);
});

router.patch("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateNoteParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const note = await updateNoteForUser(userId, params.data.id, parsed.data);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.json(note);
});

router.delete("/notes/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteNoteParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { userId } = req as AuthedRequest;
  const ok = await deleteNoteForUser(userId, params.data.id);
  if (!ok) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
