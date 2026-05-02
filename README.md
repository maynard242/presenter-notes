# Presenter Notes

A personal, login-protected website for storing and organizing presentation talking points. Notes are organized by date and event, with full-text search, markdown rendering, and two ways for AI agents to push notes programmatically: a REST endpoint and a Model Context Protocol (MCP) server.

Built for speakers who want a quiet, focused space to keep their talks organized — like a well-worn notebook before stepping on stage.

## Features

- **Login-protected** with [Clerk](https://clerk.com) — your notes stay yours
- **Markdown notes** with YAML frontmatter (title, event, date, tags), rendered with `react-markdown` + `remark-gfm`
- **Search & filter** across title, event, and content; chip-style event filters
- **File upload** through the UI (drag-and-drop or file picker)
- **REST endpoint** for any HTTP-capable agent (Replit Agent, Anthropic API tool use, scripts, etc.)
- **MCP server** at `/api/mcp` for Claude Desktop, Cursor, and other MCP clients — tools: `upload_note`, `list_notes`, `search_notes`, `get_note`
- **Mobile-friendly** responsive layout
- Warm amber styling, serif headlines, soft background imagery — calm and focused

## Tech Stack

- **Monorepo**: pnpm workspaces, TypeScript 5.9, Node 24
- **Frontend**: React 19 + Vite 7
- **Backend**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Clerk (Replit-managed)
- **API contract**: OpenAPI + Orval codegen → React Query hooks + Zod schemas
- **MCP**: `@modelcontextprotocol/sdk` over Streamable HTTP

## Project Structure

```
artifacts/
  presenter-notes/    # React + Vite frontend (preview path: /)
  api-server/         # Express API (mounted at /api)
  mockup-sandbox/     # Component preview server (design canvas)
lib/
  api-spec/           # OpenAPI spec (single source of truth)
  api-zod/            # Generated Zod schemas
  api-react-query/    # Generated React Query hooks
  db/                 # Drizzle schema + DB client
scripts/              # Shared utility scripts
```

## Local Development

Requires Node 24, pnpm 10+, and a PostgreSQL database.

```bash
pnpm install
```

Set environment variables (see [Environment Variables](#environment-variables)). Then run each artifact in its own terminal:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/presenter-notes run dev
```

The frontend is served at `/`, the API at `/api`. Access them through your dev server.

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | yes | Clerk backend secret key |
| `CLERK_PUBLISHABLE_KEY` | yes | Clerk frontend publishable key (server-side host derivation) |
| `VITE_CLERK_PUBLISHABLE_KEY` | yes | Same key, exposed to the Vite frontend |
| `AGENT_API_KEY` | yes (for agents) | Shared secret protecting both REST `/api/notes/agent-upload` and MCP `/api/mcp`. Choose any strong random string. |
| `AGENT_OWNER_USER_ID` | yes (for agents) | Clerk user id (e.g. `user_2abc...`) that owns notes created or read by the agent surfaces. Required for agent endpoints; if unset, agent uploads return 503 and MCP tools return an error. Find your id in Clerk's dashboard or by signing in and checking `auth.userId`. |
| `CORS_ORIGIN` | no | Comma-separated allowlist of origins permitted to make credentialed cross-origin requests (e.g. `https://app.example.com`). Leave unset for single-domain deployments (Vercel/Replit) — same-origin requests don't need CORS. Do not use `*` here; credentialed CORS forbids wildcards. |

> **Upgrading from a pre-ownership build:** the `notes` table now has a `user_id text not null` column. If you have existing rows (created before this version), back-fill them with the owner's Clerk user id before running `pnpm --filter @workspace/db run push --force`, or delete them if they are sample data:
>
> ```sql
> -- Option A: assign all existing notes to one owner
> UPDATE notes SET user_id = 'user_xxxxxxxx' WHERE user_id IS NULL;
>
> -- Option B: drop legacy sample notes
> DELETE FROM notes;
> ```
| `SESSION_SECRET` | yes | Session signing secret for the API server |

On Replit, Clerk keys are auto-provisioned. You only need to set `AGENT_API_KEY` yourself.

## Database

Schema is defined in `lib/db/src/schema/notes.ts` using Drizzle. To push schema changes during development:

```bash
pnpm --filter @workspace/db run push
```

Tables:
- `notes` — id (serial), title, event, event_date (date or null), content (markdown), tags (text[]), filename (nullable), created_at, updated_at

## API

The contract lives in `lib/api-spec/openapi.yaml`. After editing it, regenerate the client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

> **Note**: After running codegen, `lib/api-zod/src/index.ts` may regenerate with duplicate exports. If so, replace its contents with `export * from "./generated/api";`

### REST endpoints (Clerk session required, except where noted)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/notes` | Clerk | List notes; `?search=`, `?event=` query params |
| GET | `/api/notes/:id` | Clerk | Get a single note |
| POST | `/api/notes` | Clerk | Create note from JSON body |
| PATCH | `/api/notes/:id` | Clerk | Update note |
| DELETE | `/api/notes/:id` | Clerk | Delete note |
| POST | `/api/notes/upload` | Clerk | Upload a markdown file (parses frontmatter) |
| GET | `/api/notes/events` | Clerk | List distinct events |
| GET | `/api/notes/stats` | Clerk | Counts and recent notes for the dashboard |
| POST | `/api/notes/agent-upload` | `AGENT_API_KEY` | Programmatic upload from any agent |

### Agent REST upload

Auth is via `Authorization: Bearer <AGENT_API_KEY>` (or `X-API-Key`). The legacy
`apiKey` body field is still accepted but discouraged — body fields leak into
request-body logs.

```bash
curl -X POST https://<your-domain>/api/notes/agent-upload \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <AGENT_API_KEY>' \
  -d '{
    "filename": "my-talk.md",
    "content": "---\ntitle: My Talk\nevent: AI Conf 2025\ndate: 2025-06-01\ntags: [AI, product]\n---\n\n## Opening\n..."
  }'
```

YAML frontmatter is parsed for `title`, `event`, `date` (or `eventDate`), and `tags`. Body fields in the JSON request override frontmatter when provided.

## MCP Server (for Claude Desktop, Cursor, etc.)

The MCP server is exposed at `POST /api/mcp` using the Streamable HTTP transport in stateless mode. Auth is via the same `AGENT_API_KEY`, sent as a header (no query-param auth — those leak through logs).

**Supported headers:**
- `Authorization: Bearer <AGENT_API_KEY>`
- `X-API-Key: <AGENT_API_KEY>`

### Tools exposed

| Tool | Purpose |
|------|---------|
| `upload_note` | Upload markdown content, with optional title/event/date/tags overrides |
| `list_notes` | List notes (optional event filter, optional limit) |
| `search_notes` | Substring search across title, event, content |
| `get_note` | Fetch full content of one note by numeric id |

### Wiring into Claude Desktop

Claude Desktop speaks MCP over stdio, so wrap the remote URL with `mcp-remote`. Edit your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "presenter-notes": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-deployed-domain>/api/mcp",
        "--header",
        "Authorization: Bearer <AGENT_API_KEY>"
      ]
    }
  }
}
```

Restart Claude Desktop. The four tools will appear in the tool menu, and you can say things like *"upload this markdown to my presenter notes for AI Conf 2025."*

### Wiring into other MCP clients (Cursor, etc.)

Most MCP-aware clients accept the same Streamable HTTP URL directly. Point them at `https://<your-deployed-domain>/api/mcp` with an `Authorization: Bearer <AGENT_API_KEY>` header.

## Security Notes

- Both the REST agent endpoint and the MCP endpoint use a single shared `AGENT_API_KEY` secret.
- Token comparison is constant-time (`crypto.timingSafeEqual`).
- Query-param auth is intentionally **not** supported — secrets in URLs leak through proxy logs, browser history, and referer headers.
- All user-facing routes require a valid Clerk session.
- All Drizzle queries use parameter binding.

## Deployment

### Vercel (recommended)

This repo ships with a [`vercel.json`](./vercel.json) that:

- Builds the Vite frontend to `artifacts/presenter-notes/dist/public` (served as static assets).
- Bundles the Express API into a single Node serverless function at `api/index.mjs` and rewrites all `/api/*` requests to it.

**Steps:**

1. Push the repo to GitHub and import it into Vercel.
2. Vercel auto-detects `pnpm` from `pnpm-lock.yaml`. Leave the framework preset as **Other** — `vercel.json` overrides build/output paths.
3. In **Project Settings → Environment Variables**, set:
   - `DATABASE_URL`
   - `CLERK_SECRET_KEY`
   - `CLERK_PUBLISHABLE_KEY`
   - `VITE_CLERK_PUBLISHABLE_KEY` (same value)
   - `SESSION_SECRET`
   - `AGENT_API_KEY` (any strong random string)
   - `AGENT_OWNER_USER_ID` (Clerk user id that owns agent-uploaded notes)
4. Deploy. The build runs `pnpm run vercel-build`, which bundles the server (`pnpm --filter @workspace/api-server run build:vercel`) and builds the frontend.
5. Run `pnpm --filter @workspace/db run push` against your production database once to create tables (locally with `DATABASE_URL` pointing at prod, or via a Vercel CLI one-shot).
6. Update your Claude Desktop / Cursor / agent config with the deployed URL: `https://<your-app>.vercel.app/api/mcp`.

**Notes:**

- The MCP endpoint runs in stateless Streamable HTTP mode, which fits Vercel's request/response model. Function `maxDuration` is set to 30s in `vercel.json`; raise it on Pro plans if a tool needs longer.
- The Clerk Frontend API proxy (`/api/__clerk/*`) runs inside the same function. Custom domains work without DNS CNAME setup.
- `api/index.mjs` is generated at build time and gitignored.

### Replit

This app also runs on [Replit Deployments](https://docs.replit.com/category/deployments). After deploying:

1. Set `AGENT_API_KEY` in the Secrets tab (any strong random string).
2. Restart the API Server workflow.
3. Update your Claude Desktop / Cursor / agent config with the deployed URL.

## License

MIT
