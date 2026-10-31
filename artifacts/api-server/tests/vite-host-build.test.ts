import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { get } from "node:http";

// Node's fetch may discard custom Host headers; send a real HTTP Host header.
function hostRequest(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { Host: host } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    }).on("error", reject);
  });
}

const root = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [path.join(root, "artifacts/presenter-notes")] });
const { resolveConfig, createServer, preview } = await import(pathToFileURL(vitePath).href);
afterEach(() => vi.unstubAllEnvs());

async function configFor(artifact: string, extra = {}) {
  return resolveConfig({
    configFile: path.join(root, "artifacts", artifact, "vite.config.ts"),
    logLevel: "silent",
    ...extra,
  }, "serve", "development");
}

for (const artifact of ["presenter-notes", "mockup-sandbox"]) {
  describe(`${artifact} development and preview host policy`, () => {
    it("binds only localhost by default, even with the legacy CLI host override", async () => {
      vi.stubEnv("DEV_SERVER_HOST", "");
      vi.stubEnv("DEV_ALLOWED_HOSTS", "");
      vi.stubEnv("REPLIT_DEV_DOMAIN", "");
      const config = await configFor(artifact, {
        server: { host: "0.0.0.0", allowedHosts: true },
        preview: { host: "0.0.0.0", allowedHosts: true },
      });
      expect(config.server.host).toBe("localhost");
      expect(config.preview.host).toBe("localhost");
      expect(config.server.allowedHosts).toEqual([]);
      expect(config.preview.allowedHosts).toEqual([]);
    });
    it("requires explicit LAN binding and exact extra allowed hosts", async () => {
      vi.stubEnv("DEV_SERVER_HOST", "0.0.0.0");
      vi.stubEnv("DEV_ALLOWED_HOSTS", "Notes.Example.Test, notes.example.test, other.example.test");
      vi.stubEnv("REPLIT_DEV_DOMAIN", "project.replit.dev");
      const config = await configFor(artifact);
      expect(config.server.host).toBe("0.0.0.0");
      expect(config.preview.host).toBe("0.0.0.0");
      expect(config.server.allowedHosts).toEqual(["notes.example.test", "other.example.test", "project.replit.dev"]);
      expect(config.preview.allowedHosts).toEqual(config.server.allowedHosts);
    });
    it.each([".example.test", "*", "https://example.test", "example.test:5173", "example.test,", "bad host"])(
      "rejects broad or malformed allowed hosts: %s", async (host) => {
        vi.stubEnv("DEV_ALLOWED_HOSTS", host);
        await expect(configFor(artifact)).rejects.toThrow(/DEV_ALLOWED_HOSTS/);
      },
    );
    it("rejects a malformed Replit domain and bind host", async () => {
      vi.stubEnv("DEV_ALLOWED_HOSTS", "");
      vi.stubEnv("REPLIT_DEV_DOMAIN", "https://project.replit.dev/path");
      await expect(configFor(artifact)).rejects.toThrow(/REPLIT_DEV_DOMAIN/);
      vi.stubEnv("REPLIT_DEV_DOMAIN", "");
      vi.stubEnv("DEV_SERVER_HOST", "https://0.0.0.0");
      await expect(configFor(artifact)).rejects.toThrow(/DEV_SERVER_HOST/);
    });
    it("actually rejects an unlisted Host on the running development server", async () => {
      vi.stubEnv("DEV_SERVER_HOST", "127.0.0.1");
      vi.stubEnv("DEV_ALLOWED_HOSTS", "notes.example.test");
      vi.stubEnv("REPLIT_DEV_DOMAIN", "project.replit.dev");
      const server = await createServer({
        configFile: path.join(root, "artifacts", artifact, "vite.config.ts"),
        logLevel: "silent",
        server: { port: 0, strictPort: false, watch: null, host: "0.0.0.0", allowedHosts: true },
      });
      try {
        await server.listen();
        const address = server.httpServer.address();
        const url = `http://127.0.0.1:${address.port}/@vite/client`;
        expect(await hostRequest(url, "evil.example.test")).toBe(403);
        expect(await hostRequest(url, "notes.example.test")).toBe(200);
        expect(await hostRequest(url, "sub.notes.example.test")).toBe(403);
        expect(await hostRequest(url, "project.replit.dev")).toBe(200);
        expect(await hostRequest(url, "sub.project.replit.dev")).toBe(403);
        expect(address.address).toBe("127.0.0.1");
      } finally {
        await server.close();
      }
    }, 20_000);
    it("enforces the same exact host policy on a real preview server", async () => {
      vi.stubEnv("DEV_SERVER_HOST", "127.0.0.1");
      vi.stubEnv("DEV_ALLOWED_HOSTS", "notes.example.test");
      vi.stubEnv("REPLIT_DEV_DOMAIN", "project.replit.dev");
      const outDir = await mkdtemp(path.join(tmpdir(), "vite-host-preview-"));
      await writeFile(path.join(outDir, "index.html"), "<!doctype html><title>Host policy fixture</title>");
      let server;
      try {
        server = await preview({
          configFile: path.join(root, "artifacts", artifact, "vite.config.ts"),
          logLevel: "silent",
          build: { outDir },
          preview: { port: 0, strictPort: false, host: "0.0.0.0", allowedHosts: true },
        });
        const address = server.httpServer.address();
        const url = `http://127.0.0.1:${address.port}/`;
        expect(address.address).toBe("127.0.0.1");
        expect(await hostRequest(url, "evil.example.test")).toBe(403);
        expect(await hostRequest(url, "notes.example.test")).toBe(200);
        expect(await hostRequest(url, "sub.notes.example.test")).toBe(403);
        expect(await hostRequest(url, "project.replit.dev")).toBe(200);
        expect(await hostRequest(url, "sub.project.replit.dev")).toBe(403);
      } finally {
        if (server) await server.close();
        await rm(outDir, { recursive: true, force: true });
      }
    }, 20_000);
  });
}

describe("frontend build source fixes", () => {
  it("lazy-loads the Markdown-heavy detail page rather than importing it eagerly", async () => {
    const source = await readFile(path.join(root, "artifacts/presenter-notes/src/App.tsx"), "utf8");
    expect(source).toMatch(/lazy\(\(\) => import\("@\/pages\/note-detail"\)\)/);
    expect(source).not.toMatch(/import NoteDetail from/);
    expect(source).toContain("<Suspense");
  });
  it("removes unnecessary RSC directives rather than filtering sourcemap warnings", async () => {
    for (const component of ["label", "tooltip"]) {
      const source = await readFile(path.join(root, `artifacts/presenter-notes/src/components/ui/${component}.tsx`), "utf8");
      expect(source).not.toMatch(/^["']use client["']/m);
    }
    const config = await configFor("presenter-notes");
    expect(config.build.chunkSizeWarningLimit).toBe(500);
    const configSource = await readFile(path.join(root, "artifacts/presenter-notes/vite.config.ts"), "utf8");
    expect(configSource).not.toMatch(/onwarn|onLog|chunkSizeWarningLimit/);
  });
});
