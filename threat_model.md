# Threat Model

## Project Overview

Presenter Notes is a pnpm monorepo with a React + Vite frontend (`artifacts/presenter-notes`) and an Express 5 API (`artifacts/api-server`) backed by PostgreSQL through Drizzle (`lib/db`). Users authenticate with Replit-managed Clerk. The production app is a personal, login-protected notes system with optional agent ingestion through a REST upload endpoint and an MCP server protected by `AGENT_API_KEY`.

Production scope for this scan excludes `artifacts/mockup-sandbox`, which is a development-only preview environment and is not deployed to production under the current assumptions.

## Assets

- **User notes and metadata** — note titles, events, dates, tags, filenames, and markdown content. This is the primary business data and may contain private speaking notes or sensitive planning material.
- **User identities and sessions** — Clerk-backed session state and user identifiers. Compromise would let an attacker impersonate a user or access protected notes.
- **Agent access secret** — `AGENT_API_KEY`, which gates programmatic note ingestion and MCP access. Exposure would permit direct API access outside the browser flow.
- **Application secrets** — `DATABASE_URL`, `CLERK_SECRET_KEY`, and related deployment secrets. Compromise would expose the entire notes corpus or allow auth/service abuse.

## Trust Boundaries

- **Browser to API** — all frontend requests cross from an untrusted client into the Express server. Authentication and authorization must be enforced server-side for every note operation.
- **API to PostgreSQL** — the API server has direct database access through Drizzle. Any authorization flaw or unsafe query at the API layer exposes stored notes.
- **API to Clerk** — authentication context is supplied by Clerk middleware and proxying. The server must treat headers and session-derived identity as sensitive inputs.
- **External agent to API/MCP** — REST agent upload and MCP requests cross a separate boundary authenticated only by `AGENT_API_KEY`, not an end-user session.
- **Authenticated user to other authenticated users** — this app is described as personal and login-protected, so authenticated users must remain isolated from one another’s notes.
- **Development to production** — `artifacts/mockup-sandbox` is dev-only and should usually be ignored unless production reachability is introduced later.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/notes.ts`, `artifacts/api-server/src/mcp.ts`, `artifacts/presenter-notes/src/App.tsx`.
- **Highest-risk code areas:** note CRUD routes, note search/list queries, MCP tools, Clerk proxy middleware, and the `notes` schema in `lib/db/src/schema/notes.ts`.
- **Public vs authenticated vs admin:** landing/sign-in/sign-up are public; `/api/notes*` requires Clerk auth; `/api/notes/agent-upload` and `/api/mcp` rely on `AGENT_API_KEY`; there is no separate admin surface.
- **Dev-only areas:** `artifacts/mockup-sandbox/**`.

## Threat Categories

### Spoofing

The app relies on Clerk sessions for browser users and `AGENT_API_KEY` for machine clients. Protected note endpoints MUST require a valid Clerk-authenticated identity, and agent-only endpoints MUST require a strong secret presented through non-leaky channels. Host/header-derived Clerk proxy behavior MUST only trust deployment-controlled forwarding headers.

### Tampering

Users can create, upload, edit, and delete markdown notes. The server MUST treat all note content and metadata as untrusted input, validate it server-side, and ensure callers can only modify records they own. Agent write paths MUST be scoped so a shared automation secret cannot tamper with another user’s notes.

### Information Disclosure

The primary confidentiality risk is cross-user note exposure. All list, search, stats, fetch, and agent/MCP retrieval paths MUST be scoped to the owning user or tenant. Error handling and logs MUST avoid exposing secrets, cookies, or raw auth headers.

### Denial of Service

The API accepts JSON payloads up to 10 MB and supports full-text-like searches over note content. The service MUST avoid unauthenticated high-cost operations, and note ingestion/search paths SHOULD remain bounded so a single client cannot exhaust database or application resources.

### Elevation of Privilege

Authentication alone is not sufficient for this app because authenticated users are not mutually trusted. Every note read/write operation MUST enforce record ownership in the database layer or query predicates. Agent and MCP capabilities MUST not become a path to bypass per-user authorization boundaries.