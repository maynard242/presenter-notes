import { Router, type IRouter, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { logger } from "./lib/logger";
import { checkAgentApiKey } from "./lib/agentAuth";
import {
  createNoteFromMarkdown,
  getNoteForUser,
  listNotesForUser,
  searchNotesForUser,
} from "./lib/notesService";

const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";
const AGENT_OWNER_USER_ID = process.env.AGENT_OWNER_USER_ID ?? "";

function ownerNotConfigured() {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Agent owner not configured (AGENT_OWNER_USER_ID is unset).",
      },
    ],
  };
}

function preview(n: { id: number; title: string; event: string; eventDate: string | null; tags: string[]; content: string }) {
  return {
    id: n.id,
    title: n.title,
    event: n.event,
    eventDate: n.eventDate,
    tags: n.tags,
    preview: (n.content ?? "").slice(0, 240),
  };
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "presenter-notes", version: "1.0.0" },
    {
      capabilities: { tools: {} },
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
        title: z.string().optional().describe("Optional title (overrides frontmatter)"),
        event: z.string().optional().describe("Optional event name (overrides frontmatter)"),
        eventDate: z
          .string()
          .optional()
          .describe("Optional event date in YYYY-MM-DD format (overrides frontmatter)"),
        tags: z.array(z.string()).optional().describe("Optional tags array (overrides frontmatter)"),
      },
    },
    async ({ filename, content, title, event, eventDate, tags }) => {
      if (!AGENT_OWNER_USER_ID) return ownerNotConfigured();
      const note = await createNoteFromMarkdown(
        AGENT_OWNER_USER_ID,
        filename,
        content,
        { title, event, eventDate, tags },
      );
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
      if (!AGENT_OWNER_USER_ID) return ownerNotConfigured();
      const rows = await listNotesForUser(AGENT_OWNER_USER_ID, {
        event,
        limit: limit ?? 25,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(rows.map(preview), null, 2) }],
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
      if (!AGENT_OWNER_USER_ID) return ownerNotConfigured();
      const rows = await searchNotesForUser(AGENT_OWNER_USER_ID, query, limit ?? 25);
      return {
        content: [{ type: "text", text: JSON.stringify(rows.map(preview), null, 2) }],
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
      if (!AGENT_OWNER_USER_ID) return ownerNotConfigured();
      const note = await getNoteForUser(AGENT_OWNER_USER_ID, id);
      if (!note) {
        return {
          isError: true,
          content: [{ type: "text", text: `No note found with id ${id}` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(note, null, 2) }] };
    },
  );

  return server;
}

const router: IRouter = Router();

async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!checkAgentApiKey(req, AGENT_API_KEY)) {
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
