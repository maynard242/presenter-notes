// Builds the Express app into Vercel's Build Output API layout
// (`.vercel/output/functions/api.func/`). The Build Output API is the
// documented Vercel format for "I know exactly what I want deployed" — it
// bypasses framework auto-detection and ambiguous filename conventions.
//
// Vercel CLI sees `.vercel/output/` and uses it directly: static files from
// `static/`, functions from `functions/<name>.func/`, routing from
// `config.json`. The static side is assembled by `scripts/finalize-vercel.mjs`
// after the Vite build completes.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "..", "..");
const functionDir = path.resolve(
  repoRoot,
  ".vercel",
  "output",
  "functions",
  "api.func",
);

async function buildVercel() {
  await rm(functionDir, { recursive: true, force: true });
  await mkdir(functionDir, { recursive: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/handler.ts")],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "esm",
    outfile: path.resolve(functionDir, "index.mjs"),
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

  // Function metadata. Tells the Vercel runtime how to invoke the bundle.
  await writeFile(
    path.resolve(functionDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs20.x",
        handler: "index.mjs",
        launcherType: "Nodejs",
        shouldAddHelpers: true,
      },
      null,
      2,
    ),
  );
}

buildVercel().catch((err) => {
  console.error(err);
  process.exit(1);
});
