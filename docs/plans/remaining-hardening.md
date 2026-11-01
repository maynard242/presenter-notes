# Remaining hardening implementation plan

> **For Hermes:** Use the software-delivery workflow for the parent data/API changes and isolated subagents for disjoint frontend and origin/build changes; independently review all results before release.

**Goal:** Close the documented malformed-date, unbounded-resource, forwarding-header, development-host, and build-warning findings without deleting or rewriting existing notes.

**Architecture:** Validate effective note input at the shared service boundary. Use an additive PostgreSQL guard table for atomic per-user request budgets and serialize quota-sensitive writes with transaction advisory locks. Expose a paginated metadata endpoint while bounding the legacy array endpoint, preserving full-content GET by ID. Use explicitly trusted origins for Clerk, safe rendering of legacy dates, and lazy frontend routes.

**Tech stack:** Existing Express, PostgreSQL/Drizzle, Zod, OpenAPI/Orval, React/TanStack Query, Vite, Vitest. No new hosted service or recurring subscription.

## Approved operating defaults

- Markdown/body: at most 256 KiB UTF-8, title/event 256 characters, filename 255, at most 32 tags of 64 characters. JSON envelope: 1 MiB. Do not truncate existing notes.
- Listing: default 25, maximum 100, validated offset up to 100000, stable date/creation/id ordering. New `GET /api/notes/page` returns `{notes: NoteSummary[], hasMore}` without full bodies; legacy array endpoint remains available but bounded.
- Storage: at most 1000 notes and 100 MiB of note text per user. Existing over-quota users retain reads/deletes and can make non-growing edits; no automatic deletion.
- Per-user durable budgets: authenticated requests and mutations have separate one-minute windows, stored in one row per user. Authentication is checked before database budget consumption; request failure never bypasses limits. Budget updates commit separately from note writes so rejected attempts do not undo request accounting.
- Canonical production origin: `https://presenter-notes-api-server.vercel.app`; configure via `APP_ORIGINS` before deploying the new origin rules. Extra production domains require an explicit allowlist entry.

## Tasks and acceptance

1. **Validation, RED → GREEN** (`artifacts/api-server/src/lib/noteValidation.ts`, `errors.ts`, tests). Add tests rejecting invalid/leap/overflow dates, oversized effective frontmatter/overrides, excessive tags, empty patches. Confirm failures before implementation. Return safe 400/413 errors on REST and safe MCP tool errors, never raw database messages.
2. **PostgreSQL resource controls** (`lib/db/src/schema/resourceGuards.ts`, additive migration, `resourceGuards.ts`, integration tests). Atomic upsert fixed windows; distinguish request and write budgets. Transaction advisory locks protect quota/count checks and insert/update/delete. Bound note growth without blocking reductions for legacy over-quota users. Run against an isolated local PostgreSQL instance with synthetic identities; test concurrency, rollback, restart persistence, per-user isolation, and quota reductions.
3. **Metadata API** (`notesService.ts`, routes, MCP, OpenAPI/generated outputs). Add bounded metadata projection and stable pagination. Bound legacy and MCP listing/search and metadata fields. Tests prove WHERE owner predicates, SQL LIMIT/OFFSET, content omitted at SQL projection, correct hasMore, and invalid pagination rejected before storage.
4. **Frontend** (isolated agent: list/detail pages, cache invalidations, upload validation, date helper/tests). Show Previous/Next controls, reset paging on filters, retry errors rather than false empty/not-found, handle malformed legacy dates without throwing. Align upload rejection with backend limit.
5. **Host/build security** (isolated agent: Clerk proxy/app, Vite configs, App route loading, label/tooltip). Test forged/ambiguous/malformed forwarded origins; reject before forwarding secrets. Restrict Vite host exposure. Exercise production builds and fix actual sourcemap/chunk causes, not warning suppression.
6. **Review/release**. Reconcile docs/threat model, run Node 24 tests/typecheck/build/vercel-build/security/peer/diff checks. Require independent final review. Apply only reviewed additive SQL using production environment without printing credentials or private notes. Verify migration schema/indexes and idempotency. Commit/push explicit paths, verify remote SHA; deploy with release metadata, verify alias and read-only HTTP rejection paths. Never run a destructive schema push.

## Status — complete

Implementation, documentation, and review gates complete. Node 24.22.2 codegen, 197/197 tests (including 14 isolated PostgreSQL integration tests), typecheck, workspace/Vercel builds, dependency audit, and codegen idempotence passed. Functional review and post-fix security re-review passed; MCP batch amplification and test-URL overrides are closed with regressions. The user-authorized additive production migration was applied and read back with five guard columns and two indexes; production `APP_ORIGINS` is explicitly configured. The release procedure is commit/push, Vercel deployment with exact `releaseCommit` metadata, production-alias verification, and public/unauthorized smoke checks; its final deployment identity and smoke results are recorded in the release handoff rather than embedding a self-referential commit SHA here.

The application was pushed and deployed, the exact production release and smoke checks were verified, and temporary test infrastructure/configuration was removed. Les subsequently reported successful manual testing. The [release record](../releases/2026-10-31-hardening.md) preserves the deployed application SHA separately from later documentation commits. No implementation or release task remains pending in this plan.
