# Hardening release — 2026-10-31

## Released application

- **Production:** https://presenter-notes-api-server.vercel.app
- **Application commit:** [`7f9c1084ef2b6cf7c012eab09872fc92bb9f4dee`](https://github.com/maynard242/presenter-notes/commit/7f9c1084ef2b6cf7c012eab09872fc92bb9f4dee)
- **Vercel deployment:** `dpl_Fsfqo8ns7ckiCcEkibSnpNKanXqt`
- **Release identity:** deployment API reported `READY`, production target, the production alias, and `meta.releaseCommit` matching the application commit above. Project Node version: `24.x`.

This records the application release, not the HEAD of later documentation-only commits. The README remains the [operating runbook](../../README.md); see the [security review](../security-review.md) for controls and residual risks.

## Delivered

- Strict calendar-date and bounded-input validation shared across REST, MCP, and effective Markdown/frontmatter input; safe rendering of malformed legacy dates.
- Durable PostgreSQL request/write budgets and owner-serialized storage quotas, without rewriting or truncating existing notes.
- Metadata-only paginated API/UI, bounded legacy full-content listing, cache invalidation, read-error handling, and search/pagination race fix.
- Explicit trusted production origins, localhost-by-default development servers, and real dev/preview host-rejection tests.
- Lazy frontend routes and browser chunk splitting, resolving the prior frontend sourcemap/chunk-size warnings without raising the warning threshold.
- Rejection of MCP JSON-RPC batches before SDK dispatch, closing the independently reproduced batch-budget bypass.
- Shared loopback-only integration database URL validation, including rejection of libpq query-string host overrides before connection.

**Compatibility:** `/api/notes` retains its full-content array shape but now defaults to and caps at 10 notes. Use `/api/notes/page` for metadata pagination (default 25, maximum 100), and retrieve full content by ID. MCP accepts a single JSON-RPC message per HTTP request, not batches.

## Production changes

- Applied only the reviewed additive migration, `lib/db/migrations/0001_resource_hardening.sql`.
- Both migration application and a separate verification invocation reported `{"verified":true,"guardColumns":5,"indexes":2}` after catalog readback.
- Configured production `APP_ORIGINS` to the exact production origin and verified the value matched.
- No production note was read, created, edited, or deleted by the release checks. No forced schema push was used.

## Verification evidence

- Node **24.22.2**: **197/197 tests across 13 suites**, including **14 real PostgreSQL integration tests** using isolated synthetic schemas and a synthetic Clerk adapter.
- Default database-free run: **183 passed, 14 skipped**. Production database credentials are not required by routine tests.
- Workspace and test TypeScript checks, workspace build, Vercel packaging, dependency audit, peer checks, and Git diff checks passed.
- OpenAPI code generation was idempotent across **19 generated files**. A focused source key-signature scan found no matches; this was not a full history secret audit.
- Independent functional review passed. Security review initially blocked release on MCP batch amplification and test-URL overrides; both were fixed, regression-tested, and independently re-reviewed with a **PASS** verdict.
- Production smoke: **13 HTTP checks** and **9 unique static assets** passed. Landing/sign-in/health and the public Clerk environment endpoint returned 200; protected note/MCP routes and a header-only upload with an invalid synthetic token returned 401; malformed JSON returned the safe 400 response.
- The public landing page rendered in a real browser, and deployed JavaScript contained the paginated metadata client. The largest deployed browser JavaScript chunk was **241,662 bytes**, below the existing 500 kB threshold. The server bundle remains approximately 3.6 MB.

## Acceptance and cleanup

Les subsequently reported: “I tested it, seems to work well.” This is user-reported acceptance, not a claim of an automated authenticated production CRUD test or a detailed browser test matrix.

The temporary PostgreSQL test container was removed. The temporary test-database configuration was deleted after explicit approval and its absence was verified. No production configuration or user data was removed during cleanup.

Automated verification did not exercise a real authenticated production Clerk-session CRUD flow, backup restoration, or adversarial load testing. Those limitations remain distinct from the successful local PostgreSQL integration tests and the user's manual feedback.
