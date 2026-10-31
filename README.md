# Presenter Notes

A personal, login-protected website for storing and organizing presentation talking points. Notes are organized by date and event, with substring search, Markdown rendering, and two ways for AI agents to push notes programmatically: a REST endpoint and a Model Context Protocol (MCP) server.

Built for speakers who want a quiet, focused space to keep their talks organized — like a well-worn notebook before stepping on stage.

## Features

- **Login-protected** with [Clerk](https://clerk.com) — your notes stay yours
- **Markdown notes** with YAML frontmatter (title, event, date, tags), rendered with `react-markdown` + `remark-gfm`
- **Search & filter** across title, event, and content; chip-style event filters combine with search
- **File upload** through the UI (drag-and-drop or file picker)
- **REST endpoint** for any HTTP-capable agent (Replit Agent, Anthropic API tool use, scripts, etc.)
- **MCP server** at `/api/mcp` for Claude Desktop, Cursor, and other MCP clients — tools: `upload_note`, `list_notes`, `search_notes`, `get_note`
- **Mobile-friendly** responsive layout
- **Light and dark mode**, toggled from the header (sun/moon icon) or following the OS preference by default; choice is remembered per-browser
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
  api-client-react/   # Generated React Query hooks
  db/                 # Drizzle schema + DB client
scripts/              # Shared utility scripts
```

## Local Development

Requires Node 24, pnpm 10+, and a PostgreSQL database.

```bash
pnpm install --frozen-lockfile
```

Set environment variables (see [Environment Variables](#environment-variables)). Then run each artifact in its own terminal:

```bash
PORT=3001 pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/presenter-notes run dev
```

The frontend defaults to port 5173. Requests use same-origin `/api` paths: outside Replit, use a reverse proxy routing `/api/*` to the API on port 3001 and other paths to Vite. The bare Vite server does not proxy API requests. Export environment variables into the appropriate shells; the API does not automatically load `.env` files. The development-only sandbox defaults to port 5174 and `BASE_PATH=/`.

### Verification

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm run security:check
pnpm run vercel-build
```

Vitest tests use synthetic identities, ephemeral local HTTP servers, and mocked database transport; no live notes are read or written. They cover REST/MCP authentication and owner-scoped SQL. `security:check` audits all workspace dependencies and fails for any known vulnerability. See [the security review](docs/security-review.md) for coverage and limitations.

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
| `PORT` | standalone API only | Listener port; not required by the Vercel handler |
| `VITE_CLERK_PROXY_URL` | no | Optional frontend Clerk proxy URL |
| `BASE_PATH` | no | Frontend/sandbox base path; defaults to `/` |

`SESSION_SECRET` is not used. On Replit, Clerk keys are auto-provisioned; set **both** `AGENT_API_KEY` and `AGENT_OWNER_USER_ID` for agent access.

> **Upgrading from a pre-ownership build:** legacy databases need a reviewed migration to add `user_id`, backfill existing notes with the intended owner, and then enforce `NOT NULL`. Back up first. Do not delete existing notes or use a forced schema push as an upgrade shortcut. Builds, deployments, and the post-merge helper do not migrate the database.

## Database

Schema is defined in `lib/db/src/schema/notes.ts` using Drizzle. To push schema changes during development:

```bash
pnpm --filter @workspace/db run push
```

Tables:
- `notes` — id (serial), user_id (required owner), title, event, event_date (text or null), content (Markdown), tags (text[]), filename (nullable), created_at, updated_at

## API

The contract lives in `lib/api-spec/openapi.yaml`. After editing it, regenerate the client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

The command automatically repairs Orval's split-Zod barrel using `scripts/finalize-codegen.mjs`. Edit the spec/config, not generated schemas. Do not change the API title (`Api`).

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

The parser supports a small YAML-like subset: single-line `title`, `event`, `date` (or `eventDate`), and inline/list-style `tags`, not arbitrary YAML. Non-null JSON overrides take precedence. Uploads always create a new note; filenames are not deduplicated. A body `apiKey` is optional when using header authentication, and an explicit header takes precedence over a legacy body key.

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
- All note operations are scoped to the authenticated user, or `AGENT_OWNER_USER_ID` for agents. Missing key/owner configuration fails closed.
- Search uses escaped `ILIKE` substring patterns, not PostgreSQL full-text search. REST listing is currently unpaginated.
- Security-review scope, known limitations, and follow-ups are recorded in [docs/security-review.md](docs/security-review.md). Passing checks is not a guarantee that no vulnerabilities exist.

## Deployment

### Vercel (recommended)

The build uses Vercel's [Build Output API](https://vercel.com/docs/build-output-api/v3) — `scripts/finalize-vercel.mjs` assembles `.vercel/output/` directly, with the bundled Express app at `functions/api.func/` and the Vite SPA at `static/`. Routing is set explicitly in `config.json`, so there's no reliance on framework auto-detection or filename conventions.

**Steps:**

1. Push the repo to GitHub and import it into Vercel.
2. Leave the framework preset as **Other**. In **Settings → Build & Output Settings**, leave all overrides off — `vercel.json` provides the build and install commands.
3. In **Settings → Environment Variables**, set:
   - `DATABASE_URL`
   - `CLERK_SECRET_KEY`
   - `CLERK_PUBLISHABLE_KEY`
   - `VITE_CLERK_PUBLISHABLE_KEY` (same value)
   - `AGENT_API_KEY` (any strong random string)
   - `AGENT_OWNER_USER_ID` (Clerk user id that owns agent-uploaded notes)
   - `CORS_ORIGIN` (only if the frontend is hosted on a different origin from the API)
4. Deploy. `vercel-build` chains: API bundle → Vite build → `finalize-vercel.mjs` (writes `.vercel/output/`).
5. Provision the database through a separately reviewed schema/migration procedure. Deployment does not run migrations or modify existing notes.
6. Update your Claude Desktop / Cursor / agent config with the deployed URL: `https://<your-app>.vercel.app/api/mcp`.

**Notes:**

- The MCP endpoint runs in stateless Streamable HTTP mode. The function metadata selects Node 24. Configure timeout limits in Vercel function metadata/settings; the source `maxDuration` export alone is not a Build Output API configuration guarantee.
- The Clerk Frontend API proxy (`/api/__clerk/*`) runs inside the same function. Custom domains work without DNS CNAME setup.
- `.vercel/output/` is generated at build time and gitignored.

### Replit

This app also runs on [Replit Deployments](https://docs.replit.com/category/deployments). After deploying:

1. Set `AGENT_API_KEY` (strong random string) and `AGENT_OWNER_USER_ID` in the Secrets tab.
2. Restart the API Server workflow.
3. Update your Claude Desktop / Cursor / agent config with the deployed URL.

## License

MIT
