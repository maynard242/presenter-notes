import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { db, notesTable } from "@workspace/db";
import { logger } from "./lib/logger";

const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";
const AGENT_OWNER_USER_ID = process.env.AGENT_OWNER_USER_ID ?? "";

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
    tags = tagsMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/['"]/g, ""))
      .filter(Boolean);
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

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "presenter-notes",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Personal presenter notes server. Use these tools to upload markdown notes, list/search existing talking points, and retrieve full note content. Notes are organized by event and date.",
    },
  );

  server.registerTool(
    "upload_note",
    {
      description:
        "Upload a markdown note to the presenter notes site. Supports YAML frontmatter (title, event, date, tags) at the top of the content. Body fields override frontmatter.",
      inputSchema: {
        filename: z
          .string()
          .describe("Filename for the note, e.g. 'aiconf-2025-keynote.md'"),
        content: z
          .string()
          .describe(
            "Full markdown content. May start with YAML frontmatter:\n---\ntitle: My Talk\nevent: AI Conf 2025\ndate: 2025-06-01\ntags: [AI, product]\n---\n\n## Body...",
          ),
        title: z
          .string()
          .optional()
          .describe("Optional title (overrides frontmatter)"),
        event: z
          .string()
          .optional()
          .describe("Optional event name (overrides frontmatter)"),
        eventDate: z
          .string()
          .optional()
          .describe("Optional event date in YYYY-MM-DD format (overrides frontmatter)"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags array (overrides frontmatter)"),
      },
    },
    async ({ filename, content, title, event, eventDate, tags }) => {
      if (!AGENT_OWNER_USER_ID) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Agent owner not configured (AGENT_OWNER_USER_ID is unset)." },
          ],
        };
      }

      const fm = parseFrontmatter(content);
      const finalTitle =
        title ??
        fm.title ??
        filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
      const finalEvent = event ?? fm.event ?? "Uncategorized";
      const body = fm.body || content;

      const [note] = await db
        .insert(notesTable)
        .values({
          userId: AGENT_OWNER_USER_ID,
          title: finalTitle,
          event: finalEvent,
          eventDate: eventDate ?? fm.eventDate ?? null,
          content: body,
          tags: tags ?? fm.tags,
          filename,
        })
        .returning();

      return {
        content: [
          {
            type: "text",
            text: `Uploaded note "${note.title}" (id: ${note.id}) to event "${note.event}".`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_notes",
    {
      description:
        "List presenter notes, optionally filtered by event name. Returns titles, events, dates, tags, and a content preview — not the full body. Use get_note to read the full content.",
      inputSchema: {
        event: z
          .string()
          .optional()
          .describe("Optional event name to filter by (case-insensitive partial match)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max number of results to return (default 25)"),
      },
    },
    async ({ event, limit }) => {
      if (!AGENT_OWNER_USER_ID) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Agent owner not configured (AGENT_OWNER_USER_ID is unset)." },
          ],
        };
      }

      const max = limit ?? 25;
      const ownerFilter = eq(notesTable.userId, AGENT_OWNER_USER_ID);
      let q = db.select().from(notesTable).$dynamic();
      if (event) {
        q = q.where(and(ownerFilter, ilike(notesTable.event, `%${event}%`)));
      } else {
        q = q.where(ownerFilter);
      }
      const rows = await q
        .orderBy(desc(notesTable.eventDate), desc(notesTable.createdAt))
        .limit(max);

      const summaries = rows.map((n) => ({
        id: n.id,
        title: n.title,
        event: n.event,
        eventDate: n.eventDate,
        tags: n.tags,
        preview: (n.content ?? "").slice(0, 240),
      }));

      return {
        content: [
          { type: "text", text: JSON.stringify(summaries, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "search_notes",
    {
      description:
        "Search presenter notes across title, event, and content. Returns matching notes with previews.",
      inputSchema: {
        query: z.string().describe("Search query (case-insensitive substring match)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max number of results to return (default 25)"),
      },
    },
    async ({ query, limit }) => {
      if (!AGENT_OWNER_USER_ID) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Agent owner not configured (AGENT_OWNER_USER_ID is unset)." },
          ],
        };
      }

      const max = limit ?? 25;
      const pattern = `%${query}%`;
      const rows = await db
        .select()
        .from(notesTable)
        .where(
          and(
            eq(notesTable.userId, AGENT_OWNER_USER_ID),
            or(
              ilike(notesTable.title, pattern),
              ilike(notesTable.event, pattern),
              ilike(notesTable.content, pattern),
            ),
          ),
        )
        .orderBy(desc(notesTable.eventDate), desc(notesTable.createdAt))
        .limit(max);

      const summaries = rows.map((n) => ({
        id: n.id,
        title: n.title,
        event: n.event,
        eventDate: n.eventDate,
        tags: n.tags,
        preview: (n.content ?? "").slice(0, 240),
      }));

      return {
        content: [
          { type: "text", text: JSON.stringify(summaries, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "get_note",
    {
      description:
        "Fetch the full content of a single note by id. Returns the complete markdown body and metadata.",
      inputSchema: {
        id: z
          .number()
          .int()
          .describe("Numeric note id (from list_notes or search_notes)"),
      },
    },
    async ({ id }) => {
      if (!AGENT_OWNER_USER_ID) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Agent owner not configured (AGENT_OWNER_USER_ID is unset)." },
          ],
        };
      }

      const [note] = await db
        .select()
        .from(notesTable)
        .where(
          and(
            eq(notesTable.id, id),
            eq(notesTable.userId, AGENT_OWNER_USER_ID),
          ),
        );

      if (!note) {
        return {
          isError: true,
          content: [{ type: "text", text: `No note found with id ${id}` }],
        };
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(note, null, 2) },
        ],
      };
    },
  );

  return server;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const xHeader = req.headers["x-api-key"];
  if (typeof xHeader === "string" && xHeader.trim()) return xHeader.trim();
  return null;
}

function checkApiKey(req: Request): boolean {
  if (!AGENT_API_KEY) return false;
  const token = extractToken(req);
  if (!token) return false;
  return safeEqual(token, AGENT_API_KEY);
}

const router: IRouter = Router();

async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!checkApiKey(req)) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="presenter-notes"')
      .json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid API key" },
        id: null,
      });
    return;
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP error" },
        id: null,
      });
    }
  }
}

router.post("/mcp", handleMcp);
router.get("/mcp", handleMcp);
router.delete("/mcp", handleMcp);

export default router;
