# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Personal presenter notes app with Clerk auth, PostgreSQL, and markdown upload support.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **Auth**: Replit-managed Clerk (`@clerk/express` server, `@clerk/react` frontend)
- **Frontend**: React + Vite (artifact: `presenter-notes`, preview path `/`)
- **Markdown rendering**: `react-markdown` + `remark-gfm`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm test` — REST/MCP and database-query regressions with synthetic data
- `pnpm run security:check` — audit all workspace dependencies
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- `artifacts/presenter-notes` — React + Vite frontend, preview path `/`
- `artifacts/api-server` — Express 5 API server, preview path `/api`

## Authentication

Uses Replit-managed Clerk. Keys are auto-provisioned (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`). The production Clerk proxy is `/api/__clerk`. All note routes require a Clerk session except `/api/notes/agent-upload`, which uses the agent key. Every database operation is owner-scoped.

## Database Schema

- `notes` table: id, user_id (required), title, event, event_date (text), content (Markdown), tags (text[]), filename, created_at, updated_at

## Agent Integration (REST + MCP)

The `AGENT_API_KEY` secret protects both REST and MCP. Set it and `AGENT_OWNER_USER_ID` in the Secrets tab. Missing configuration fails closed. Prefer header authentication; the REST body-key example below is legacy compatibility only. See README.md for the current header-only example.

### REST endpoint (any HTTP-capable agent)

```
POST /api/notes/agent-upload
Content-Type: application/json

{
  "apiKey": "<AGENT_API_KEY secret>",
  "filename": "my-talk.md",
  "content": "---\ntitle: My Talk\nevent: Conference 2025\ndate: 2025-06-01\ntags: [AI, product]\n---\n\n## Main points...",
  "title": "Optional override title",
  "event": "Optional override event",
  "eventDate": "2025-06-01",
  "tags": ["optional", "override", "tags"]
}
```

Markdown frontmatter is parsed for title, event, date, and tags. Explicit body fields override frontmatter.

### MCP endpoint (Claude Desktop, Cursor, other MCP clients)

`POST /api/mcp` (Streamable HTTP transport, stateless). Auth via `Authorization: Bearer <AGENT_API_KEY>` header (also accepts the `X-API-Key` header). Query-string and body-key authentication are not supported for MCP.

Tools exposed:
- `upload_note` — upload markdown content with frontmatter
- `list_notes` — list with optional event filter
- `search_notes` — substring search across title/event/content
- `get_note` — fetch full note by id

Implementation lives in `artifacts/api-server/src/mcp.ts`.

#### Claude Desktop config

Claude Desktop speaks MCP over stdio, so wrap the remote URL with `mcp-remote`. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop. The four tools appear in the tools menu.

## Note on api-zod index.ts

The codegen command automatically repairs the split-Zod barrel using `scripts/finalize-codegen.mjs`. Do not edit generated files manually.

README.md is the canonical runbook. See docs/security-review.md for the release security scope. Database migration is never an automatic post-merge/deployment step.
