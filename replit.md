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

Production also requires `APP_ORIGINS`: exact comma-separated HTTPS deployment/custom origins. Forwarded headers never establish trust. Missing/invalid origin config fails closed. Development accepts loopback HTTP or the exact validated `REPLIT_DEV_DOMAIN`. Both Vite servers default to localhost; opt into LAN binding via `DEV_SERVER_HOST` and exact `DEV_ALLOWED_HOSTS`, never a wildcard.

## Database Schema

- `notes` table: id, user_id (required), title, event, event_date (text), content (Markdown), tags (text[]), filename, created_at, updated_at
- `resource_guards`: independent durable request/write counters in fixed one-minute windows, one row per owner

Before deploying this release against an existing owner-scoped database, explicitly apply and verify the additive guard/index migration (not `push --force`):

```sh
pnpm --filter @workspace/db exec node scripts/harden.mjs --apply
pnpm --filter @workspace/db exec node scripts/harden.mjs --verify
```

Limits: 256 KiB UTF-8 Markdown (including upload frontmatter), 1 MiB JSON, real calendar dates, 256-character title/event, 32 tags of 64 characters, 255-character filename. PostgreSQL enforces application budgets of 120 requests/minute and 20 persistence write attempts/minute per owner. All service writes serialize quota checks: 1000 notes and 100 MiB UTF-8 note text per owner. Existing data is never rewritten/truncated; over-quota owners may read/delete and make non-growing edits. See README.md for error semantics, migration timeouts, and limitations.

The UI uses `/api/notes/page`: metadata/previews, default 25/max 100 notes with limit/offset and `{notes, hasMore}`. The legacy `/api/notes` full-content array is now limited to default/max 10. Callers must paginate instead of assuming an entire corpus. Opt-in PostgreSQL integration tests require a disposable loopback `TEST_DATABASE_URL` ending in `_test`; default tests need no database.

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
- `list_notes` — metadata/previews with optional event filter, limit (25 default/100 max), and offset
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

The [completed hardening release record](docs/releases/2026-10-31-hardening.md) contains the verified application commit/deployment, production migration and smoke evidence, user-reported acceptance, and cleanup status. MCP batches are intentionally rejected before tool dispatch; send one JSON-RPC message per HTTP request.
