# Maintenance security review

Date: 2026-10-31. Scope: the Presenter Notes application and dependency tree, not a penetration test or vulnerability-free certification.

## Result

**Source review and final maintenance diff review: PASS, no demonstrated security release blockers.** Independent read-only reviews found no confirmed authentication bypass, cross-user note access, SQL injection, stored XSS, credential disclosure, or blocking maintenance regression. The final reviewer independently ran all 33 tests, TypeScript checks, dependency audit, peer checks, and script/diff checks. The maintainer separately exercised code generation and both build paths under Node 24.

The registry audit initially reported 1 critical, 21 high, 27 moderate, and 4 low findings. After dependency updates, `pnpm run security:check` reports **no known vulnerabilities**, including development dependencies. React was updated within the 19.1 series to satisfy Clerk's peer requirements. Zod was moved to the patched 4.x line, and the OpenAPI client/validators were regenerated using the updated Orval version. Registry advisories and audit results are time-sensitive.

## Verified controls

- Browser routes require Clerk-derived user identity; caller-supplied ownership is not accepted.
- List/search, events, stats, get, update, and delete queries contain owner predicates and bind parameters through Drizzle.
- Search/event filtering combines with ownership; SQL wildcard characters are escaped as literals.
- Agent REST and MCP authentication fail closed when the configured secret is empty or wrong. REST authentication accepts Bearer/X-API-Key headers without a body key and retains the legacy body-key fallback. A valid explicit header takes precedence.
- Query-string credentials are not accepted. MCP does not accept body credentials.
- Agent reads/writes use only `AGENT_OWNER_USER_ID`; missing owner configuration prevents data access.
- MCP exposes only upload/list/search/get tools, bounds list/search limits, and uses the upgraded stateless HTTP transport.
- Source review checked Markdown rendering for raw HTML/JavaScript URL exposure. There is no raw-HTML rendering plugin configured.
- Environment files and Vercel local state are ignored by Git. Post-merge/build/deployment does not automatically modify database schema.

## Executable evidence

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

## Open advisory findings

These were not demonstrated release blockers and were deliberately not expanded into a new subsystem in this maintenance pass:

1. **Medium — invalid dates can break an owner's UI.** `eventDate` is stored as text and not validated consistently across REST/MCP/frontmatter. Rendering with `date-fns.format` can throw for malformed values. Follow-up: validate at the shared service boundary and guard legacy invalid dates in the UI. An authenticated writer/agent can affect its configured owner's notes view; cross-user access was not found.
2. **Medium, conditional — resource exhaustion.** JSON accepts up to 10 MB, note fields have no per-user quota, REST listings return complete bodies without pagination, and distributed rate limiting is not configured in the application. Follow-up: bound content/metadata, paginate metadata-only lists, and configure per-user/edge abuse controls. Actual Clerk signup policy and hosting-level protections were not inspected; no load attack was performed.
3. **Low, ingress-dependent — forwarded host/protocol trust.** Clerk configuration uses forwarded headers. The proxy destination is fixed; a signing-key/authentication bypass was not demonstrated. Deployment ingress must overwrite forwarding headers. Follow-up: a canonical-origin/hostname allowlist if direct or untrusted ingress is supported.
4. **Development exposure.** Vite uses Replit-oriented permissive host settings and can listen on all interfaces. Use trusted networks; do not expose a development server as production.

## Limits

No production note was created, edited, or deleted for verification. No production migration, account enumeration, brute force, load test, or secret rotation was performed. Authenticated browser CRUD, live database ownership isolation, Clerk configuration, backup coverage, and edge enforcement require separate integration/operations checks. Post-deployment smoke checks should verify the landing/sign-in routes, process health, static assets, and unauthenticated rejection of protected APIs without reading private notes.
