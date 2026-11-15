// Final step of the Vercel build: assemble the Build Output API tree at
// `.vercel/output/`.
//
// At this point:
//   - `.vercel/output/functions/api.func/` already exists (written by
//     artifacts/api-server's build:vercel)
//   - `artifacts/presenter-notes/dist/public/` contains the Vite output
//
// This script copies the Vite output into `.vercel/output/static/` and writes
// the routing config that maps `/api/*` → the api function and everything
// else → static files.

import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const outputRoot = path.resolve(repoRoot, ".vercel", "output");
const staticDir = path.resolve(outputRoot, "static");
const viteOutput = path.resolve(
  repoRoot,
  "artifacts",
  "presenter-notes",
  "dist",
  "public",
);

// Security headers, attached as Build Output routes with `continue: true` so
// they apply to every response (static files, the SPA fallback, and /api
// function responses) without changing routing. Vercel already adds HSTS.
const baseSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// API responses are JSON only. A `default-src 'none'` CSP is safe there and
// stricter than the document policy below.
const apiSecurityHeaders = {
  ...baseSecurityHeaders,
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

/**
 * Build the document CSP for the SPA.
 *
 * - scripts: only Vite chunks ('self') plus a sha256 hash per inline <script>
 *   found in the built index.html (the theme-flash bootstrap). Hashing the
 *   built output keeps the CSP valid if the inline script ever changes.
 * - Clerk: today the browser talks directly to the Clerk Frontend API domain
 *   encoded in the publishable key baked into the bundle (proxy mode is not
 *   enabled in production yet). Derive the allowed origins from the built
 *   key so the CSP stays correct across key swaps (dev → live instance).
 *   Fail the build if no key is found: the app cannot authenticate without
 *   one, so a silently missing key must not pass.
 * - styles: 'unsafe-inline' is required — Clerk components and shadcn set
 *   inline styles; Google Fonts supplies the Inter stylesheet.
 * - images: deliberately permissive (markdown notes may embed remote images).
 */
async function buildSpaSecurityHeaders() {
  const html = await readFile(path.join(staticDir, "index.html"), "utf8");
  const scriptHashes = [...html.matchAll(
    /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
  )].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);

  const jsFiles = (await readdir(path.join(staticDir, "assets"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => readFile(path.join(staticDir, "assets", entry.name), "utf8"));
  const keyMatch = (await Promise.all(jsFiles))
    .flatMap((source) => [...source.matchAll(/\bpk_(?:test|live)_([A-Za-z0-9+/=_-]{20,})\b/g)])
    .map((m) => m[1])
    .find(Boolean);
  if (!keyMatch) {
    throw new Error("No Clerk publishable key found in the built bundle; refusing to emit a CSP that would break sign-in");
  }
  // Publishable key suffix is base64url of "<fapi-domain>$".
  const clerkDomain = Buffer.from(keyMatch, "base64").toString("utf8").replace(/\$$/, "");
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(clerkDomain)) {
    throw new Error(`Extracted Clerk domain is not a plain hostname: ${clerkDomain}`);
  }
  const clerkOrigins = [`https://${clerkDomain}`, `https://clerk.${clerkDomain}`];

  const csp = [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.length ? ` ${scriptHashes.join(" ")}` : ""} ${clerkOrigins.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src * data: blob:",
    `connect-src 'self' ${clerkOrigins.join(" ")}`,
    `frame-src 'self' ${clerkOrigins.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return { ...baseSecurityHeaders, "Content-Security-Policy": csp };
}

async function finalize() {
  await rm(staticDir, { recursive: true, force: true });
  await mkdir(staticDir, { recursive: true });
  await cp(viteOutput, staticDir, { recursive: true });

  const spaSecurityHeaders = await buildSpaSecurityHeaders();

  // Routing rules:
  //   1. Header routes (continue: true) attach security headers and fall
  //      through. API paths get the JSON policy; everything else gets the
  //      SPA document policy.
  //   2. `handle: filesystem` — serve any matching static file (CSS, JS,
  //      images, index.html) before falling through to functions.
  //   3. `^/api(?:/.*)?$` → `/api` — every /api request is invoked against
  //      the api function. The original req.url is preserved for Express
  //      routing.
  //   4. `.*` → `/index.html` — SPA fallback: any unmatched path serves the
  //      Vite-built index.html so client-side routing (Wouter) works on
  //      hard refresh.
  const config = {
    version: 3,
    routes: [
      {
        src: "^/api(?:/.*)?$",
        headers: apiSecurityHeaders,
        continue: true,
      },
      {
        // Everything except /api (negative lookahead — a plain ^/.*$ here
        // would also match /api and override the stricter API policy above).
        src: "^(?!/api(?:/|$)).*$",
        headers: spaSecurityHeaders,
        continue: true,
      },
      { handle: "filesystem" },
      { src: "^/api(?:/.*)?$", dest: "/api" },
      { src: "^/.*$", dest: "/index.html" },
    ],
  };

  await writeFile(
    path.resolve(outputRoot, "config.json"),
    JSON.stringify(config, null, 2),
  );

  console.log(
    `[finalize-vercel] static → ${path.relative(repoRoot, staticDir)}`,
  );
  console.log(
    `[finalize-vercel] config → ${path.relative(repoRoot, outputRoot)}/config.json`,
  );
}

finalize().catch((err) => {
  console.error(err);
  process.exit(1);
});
