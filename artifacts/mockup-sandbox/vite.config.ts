import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { isIP } from "node:net";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const rawPort = process.env.PORT ?? "5174";

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

function exactHost(value: string, variable: string): string {
  if (!value || (!isIP(value) && !value.split(".").every((label) =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
  ))) throw new Error(`${variable} must contain exact hostnames or IP addresses, not URLs or wildcards`);
  return value.toLowerCase();
}

// LAN access requires explicit opt-in, including in Replit workspaces.
const devHost = exactHost(process.env.DEV_SERVER_HOST || "localhost", "DEV_SERVER_HOST");
const allowedHosts = [...new Set([
  ...(process.env.DEV_ALLOWED_HOSTS
    ? process.env.DEV_ALLOWED_HOSTS.split(",").map((host) => exactHost(host.trim(), "DEV_ALLOWED_HOSTS"))
    : []),
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [exactHost(process.env.REPLIT_DEV_DOMAIN, "REPLIT_DEV_DOMAIN")]
    : []),
])];

export default defineConfig({
  base: basePath,
  plugins: [
    {
      name: "explicit-development-host-policy",
      enforce: "post",
      // Vite merges allowedHosts arrays (and true wins), then adds bind hosts.
      // Assign after resolution so CLI flags cannot widen this env-only policy.
      configResolved(config) {
        config.server.host = devHost;
        config.preview.host = devHost;
        config.server.allowedHosts = [...allowedHosts];
        config.preview.allowedHosts = [...allowedHosts];
      },
    },
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: devHost,
    allowedHosts: [...allowedHosts],
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: devHost,
    allowedHosts: [...allowedHosts],
  },
});
