# Security review

## Remaining-issues hardening — 2026-10-31

Scope: source, generated contracts, dependencies, local synthetic integration tests, and additive migration safety. This is not a penetration test or a vulnerability-free certification. The previous maintenance release's evidence is retained below as historical context.

### Current gate

**PASS:** maintainer verification, independent functional review, and focused security re-review. Initial security review found an MCP batch-budget bypass and a test-URL query-override risk; both were fixed and independently re-reviewed. The re-review ran 30 focused tests and separately proved both integration suites reject `host`/`hostaddr` query overrides before database setup. The production additive migration was applied and read back successfully (`verified: true`, five guard columns, two indexes); production `APP_ORIGINS` was explicitly configured. Deployment identity must match the Git SHA through Vercel `releaseCommit` metadata and the production alias; final public smoke evidence belongs to the release handoff.

### Resolved earlier advisory findings

Deployment, migration readback, public smoke checks, user-reported acceptance, and temporary-file cleanup are recorded in the [completed release handoff](releases/2026-10-31-hardening.md). User feedback does not expand the automated authenticated-production test coverage described below.

- **Malformed calendar dates:** shared service validation rejects invalid new dates on create/update/Markdown upload, including effective frontmatter. Generated schemas preserve date-only strings instead of coercing them through JavaScript Date rollover. Frontend calendar parsing safely rejects malformed legacy values and preserves local calendar days. Existing notes are not rewritten.
- **Per-note and request bounds:** 256 KiB UTF-8 Markdown, 1 MiB JSON, bounded title/event/filename/tags, valid IDs/filters/pagination, safe 400/413 errors. Unexpected HTTP/MCP failures expose neither SQL nor exception text; logging omits raw exception data.
- **Distributed resource controls:** one PostgreSQL guard row per authenticated owner, with independent 120-request/20-write fixed minute windows, atomic UPSERT, database clock, and 429/Retry-After. Persistence budget charges commit separately from note writes and survive rejected/rolled-back operations. All app create/update/delete paths use the same owner transaction advisory lock before quota reads. Limits are 1000 notes and 100 MiB UTF-8 text; non-growing legacy edits and deletion remain available without truncation.
- **MCP batch amplification:** the installed SDK dispatches batch entries concurrently, so one HTTP budget charge previously admitted up to 100 reads. Arrays are now rejected with HTTP 400 / JSON-RPC -32600 after authenticated request charging but before any SDK dispatch. Regressions for empty, two-entry and 100-entry batches fail on the original code and pass with zero storage calls after the fix.
- **Integration target override:** both PostgreSQL suites now use one pre-connection URL validator rejecting remote hosts, non-test databases, all supplied query options and fragments. Direct tests reject libpq `host`/`hostaddr` overrides without opening a connection.
- **Bounded reads:** `/api/notes/page` projects metadata and 240-character previews directly in PostgreSQL; limit defaults to 25/max 100 with offset up to 100000 and an ID sort tie-breaker. The UI uses this endpoint and invalidates its cached pages after mutations. Legacy full-content listing is limited to default/max 10; events to 1000; stats retains five recent full notes for compatibility. MCP list/search use SQL-projected previews rather than loading full bodies.
- **Forwarded-header trust:** production Clerk origin/proxy configuration is derived only from exact HTTPS `APP_ORIGINS`. Headers select allowlisted origins, never establish trust. Malformed/multiple values fail before server credentials are forwarded to the fixed Clerk upstream. Missing/invalid production configuration fails closed.
- **Development exposure:** both Vite servers bind localhost by default and enforce exact hostnames after Vite merges permissive CLI/inline settings and appends bind hosts. Separate array copies prevent Vite mutating the validated allowlist; the Replit overlay was not responsible. LAN binding requires deliberate configuration. Real local HTTP tests reject unlisted hosts on dev and preview servers.
- **Frontend build warnings:** lazy routes and a real React vendor split bring all browser JavaScript chunks below the existing 500 kB threshold. Unnecessary source directives were removed to eliminate the associated sourcemap diagnostics; warning thresholds are not inflated. The server bundle remains approximately 3.6 MB, which is not a browser chunk.

### Maintainer evidence

Verified on Node **24.22.2**:

```sh
pnpm --filter @workspace/api-spec run codegen
TEST_DATABASE_URL='<isolated loopback PostgreSQL test database>' pnpm test
pnpm run typecheck
pnpm run build
pnpm run vercel-build
pnpm run security:check
```

**197/197 tests across 13 suites passed**, including **14 real PostgreSQL integration tests** in isolated per-suite schemas. These exercise concurrent rate cutoffs, separate pooled workers, rollover, independently committed charges, rollback/lock release, last-slot quota races, UTF-8 metadata/tag accounting, legacy reductions, exact migration/index verification and idempotency, service CRUD/ownership/date handling, deterministic metadata pages/hasMore, and real REST/MCP handlers backed by synthetic database records. Clerk identity is mocked, not a real login. Without the opt-in test URL, PostgreSQL tests skip; routine tests never require production credentials.

Typecheck, workspace build, Vercel packaging, and dependency audit passed. The frontend build contains no prior sourcemap/chunk-size diagnostics; largest browser chunk approximately 241 kB before gzip. Registry audit reports no known vulnerabilities, including development dependencies; this is time-sensitive advisory evidence, not a full code vulnerability scan.

### Operational controls and residual limits

- Apply only `lib/db/migrations/0001_resource_hardening.sql` via `lib/db/scripts/harden.mjs --apply`, then `--verify`, before deploying. It creates a guard table and two owner indexes, takes bounded migration locks, and verifies exact committed catalog shape. It never changes note contents/ownership. Index creation can briefly block writes. Backups and restoration readiness remain an operations responsibility; no forced schema push is authorized by this procedure.
- Configure production `APP_ORIGINS` before rollout. Preview/custom domains need explicit entries in the intended environment. Do not rely on forwarded headers or deployment metadata as implicit trust.
- Fixed minute windows permit bursts across boundaries, and per-user limits do not impose a global account/storage ceiling. Unauthenticated parsing/Clerk costs, signup policy, edge limits and deliberate load attacks remain hosting/auth policy concerns. Direct SQL writers can bypass app locks and quotas.
- Existing oversized/invalid legacy records are retained, and full-content GET/stats/legacy responses can still include those old bodies. Offset pagination is deterministic for a stable dataset, not a cross-request snapshot.
- No production note is created, edited, deleted, or read for smoke testing. Live authenticated browser CRUD, a real Clerk session flow, backup restoration, account enumeration, brute-force resistance and load testing are outside this release's verification. Public smoke checks cover landing/sign-in/static/health routes and unauthorized API/MCP rejection.

---

## Historical first maintenance release

Date: 2026-10-31. Scope: the Presenter Notes application and dependency tree, not a penetration test or vulnerability-free certification.

### Result

**Source review and final maintenance diff review: PASS, no demonstrated security release blockers.** Independent read-only reviews found no confirmed authentication bypass, cross-user note access, SQL injection, stored XSS, credential disclosure, or blocking maintenance regression. The final reviewer independently ran all 33 tests, TypeScript checks, dependency audit, peer checks, and script/diff checks. The maintainer separately exercised code generation and both build paths under Node 24.

The registry audit initially reported 1 critical, 21 high, 27 moderate, and 4 low findings. After dependency updates, `pnpm run security:check` reports **no known vulnerabilities**, including development dependencies. React was updated within the 19.1 series to satisfy Clerk's peer requirements. Zod was moved to the patched 4.x line, and the OpenAPI client/validators were regenerated using the updated Orval version. Registry advisories and audit results are time-sensitive.

### Verified controls

- Browser routes require Clerk-derived user identity; caller-supplied ownership is not accepted.
- List/search, events, stats, get, update, and delete queries contain owner predicates and bind parameters through Drizzle.
- Search/event filtering combines with ownership; SQL wildcard characters are escaped as literals.
- Agent REST and MCP authentication fail closed when the configured secret is empty or wrong. REST authentication accepts Bearer/X-API-Key headers without a body key and retains the legacy body-key fallback. A valid explicit header takes precedence.
- Query-string credentials are not accepted. MCP does not accept body credentials.
- Agent reads/writes use only `AGENT_OWNER_USER_ID`; missing owner configuration prevents data access.
- MCP exposes only upload/list/search/get tools, bounds list/search limits, and uses the upgraded stateless HTTP transport.
- Source review checked Markdown rendering for raw HTML/JavaScript URL exposure. There is no raw-HTML rendering plugin configured.
- Environment files and Vercel local state are ignored by Git. Post-merge/build/deployment does not automatically modify database schema.

### Executable evidence

Run on Node 24:

```sh
pnpm test
pnpm run typecheck
pnpm run build
pnpm run vercel-build
pnpm run security:check
pnpm peers check
```

All **33 tests across four suites passed**. Regression tests live in `artifacts/api-server/tests`. They use synthetic keys/identities, real Express/MCP HTTP handlers on ephemeral localhost ports, and mocked database transport to inspect actual generated PostgreSQL queries. No live database is needed or modified. These tests do not establish full Clerk/session/database integration behavior. A focused key-signature scan of tracked/nonignored source found no matches; this is not a full Git-history secret audit.

A successful build still emits existing frontend sourcemap diagnostics and a large-chunk warning. Those are not security passes or failures.

### Historical advisory findings (resolved in the hardening release)

These were not demonstrated release blockers and were deliberately not expanded into a new subsystem in this maintenance pass:

1. **Medium — invalid dates can break an owner's UI.** `eventDate` is stored as text and not validated consistently across REST/MCP/frontmatter. Rendering with `date-fns.format` can throw for malformed values. Follow-up: validate at the shared service boundary and guard legacy invalid dates in the UI. An authenticated writer/agent can affect its configured owner's notes view; cross-user access was not found.
2. **Medium, conditional — resource exhaustion.** JSON accepts up to 10 MB, note fields have no per-user quota, REST listings return complete bodies without pagination, and distributed rate limiting is not configured in the application. Follow-up: bound content/metadata, paginate metadata-only lists, and configure per-user/edge abuse controls. Actual Clerk signup policy and hosting-level protections were not inspected; no load attack was performed.
3. **Low, ingress-dependent — forwarded host/protocol trust.** Clerk configuration uses forwarded headers. The proxy destination is fixed; a signing-key/authentication bypass was not demonstrated. Deployment ingress must overwrite forwarding headers. Follow-up: a canonical-origin/hostname allowlist if direct or untrusted ingress is supported.
4. **Development exposure.** Vite uses Replit-oriented permissive host settings and can listen on all interfaces. Use trusted networks; do not expose a development server as production.

### Historical verification limits

No production note was created, edited, or deleted for verification. No production migration, account enumeration, brute force, load test, or secret rotation was performed. Authenticated browser CRUD, live database ownership isolation, Clerk configuration, backup coverage, and edge enforcement require separate integration/operations checks. Post-deployment smoke checks should verify the landing/sign-in routes, process health, static assets, and unauthenticated rejection of protected APIs without reading private notes.
