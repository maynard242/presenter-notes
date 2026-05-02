// Bundles the Express app into a single Vercel serverless function at
// <repoRoot>/api/index.mjs. The entrypoint exports the Express app as the
// default handler, which @vercel/node invokes per request.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "..", "..");
const outDir = path.resolve(repoRoot, "api");

async function buildVercel() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/handler.ts")],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "esm",
    // Catch-all filename: Vercel routes all /api/* requests to this single
    // function with the original request URL preserved. With a plain
    // `index.mjs` we would have needed a rewrite, and Vercel rewrites strip
    // the captured path unless every sub-path also has a function.
    outfile: path.resolve(outDir, "[...path].mjs"),
    logLevel: "info",
    conditions: ["workspace"],
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "pg-native",
    ],
    sourcemap: "linked",
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  });
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
