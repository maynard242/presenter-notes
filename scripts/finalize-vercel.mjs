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
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

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

async function finalize() {
  await rm(staticDir, { recursive: true, force: true });
  await mkdir(staticDir, { recursive: true });
  await cp(viteOutput, staticDir, { recursive: true });

  // Routing rules:
  //   1. `handle: filesystem` — serve any matching static file (CSS, JS,
  //      images, index.html) before falling through to functions.
  //   2. `^/api(?:/.*)?$` → `/api` — every /api request is invoked against
  //      the api function. The original req.url is preserved for Express
  //      routing.
  //   3. `.*` → `/index.html` — SPA fallback: any unmatched path serves the
  //      Vite-built index.html so client-side routing (Wouter) works on
  //      hard refresh.
  const config = {
    version: 3,
    routes: [
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
