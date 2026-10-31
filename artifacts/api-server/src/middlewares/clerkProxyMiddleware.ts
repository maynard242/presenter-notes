/**
 * Clerk Frontend API proxy for production/custom-domain and Replit deployments.
 * Mount BEFORE express.json(). Development Clerk instances bypass this proxy.
 *
 * Configure APP_ORIGINS with exact comma-separated HTTPS public origins, e.g.
 * https://presenter-notes-api-server.vercel.app. Production never infers trust
 * from request headers or deployment metadata. Replit production/custom domains
 * must also be listed. Development permits loopback HTTP and the exact validated
 * REPLIT_DEV_DOMAIN over HTTPS. Clerk's Replit Auth pane configuration is unchanged.
 */
import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { ServiceError } from "../lib/errors";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

type OriginRequest = {
  headers: IncomingHttpHeaders;
  socket?: { encrypted?: boolean; remoteAddress?: string };
};

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || /[\s,]/.test(value)) {
    throw new ServiceError(400, "Invalid request origin headers");
  }
  return value;
}

function authorityUrl(authority: string): URL {
  // Validate syntax before URL parsing: URL silently normalizes credentials,
  // backslashes, abbreviated IPs and other inputs that must not establish trust.
  if (!/^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?$/.test(authority)) {
    throw new Error("Invalid authority");
  }
  const url = new URL(`https://${authority}`);
  const hostname = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0]!;
  if (url.hostname !== hostname.toLowerCase()) throw new Error("Noncanonical host");
  if (!hostname.startsWith("[") && !hostname.split(".").every((label) =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
  )) throw new Error("Invalid hostname");
  return url;
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function configuredOrigins(production: boolean): Set<string> {
  try {
    const raw = process.env.APP_ORIGINS;
    if (!raw && production) throw new Error("Missing origins");
    const origins = new Set<string>();
    for (const entry of raw ? raw.split(",") : []) {
      const match = /^(https?):\/\/([^/?#]+)\/?$/.exec(entry.trim());
      if (!match) throw new Error("Invalid origin");
      const url = authorityUrl(match[2]!);
      if (match[1] === "http" && (production || !isLoopback(url.hostname))) {
        throw new Error("HTTPS required");
      }
      url.protocol = `${match[1]}:`;
      origins.add(url.origin);
    }
    if (!production && process.env.REPLIT_DEV_DOMAIN) {
      origins.add(authorityUrl(process.env.REPLIT_DEV_DOMAIN).origin);
    }
    return origins;
  } catch {
    // Never echo configuration values, credentials or untrusted headers.
    throw new ServiceError(503, "Application origins are not configured correctly");
  }
}

/** Resolve only allowlisted origins; forwarded headers are selectors, not trust. */
export function getTrustedAppOrigin(req: OriginRequest): string {
  const production = process.env.NODE_ENV === "production";
  const origins = configuredOrigins(production);
  const host = singleHeader(req.headers.host);
  const forwardedHost = singleHeader(req.headers["x-forwarded-host"]);
  const forwardedProto = singleHeader(req.headers["x-forwarded-proto"]);
  if (!host || (forwardedProto !== undefined && !["http", "https"].includes(forwardedProto))) {
    throw new ServiceError(400, "Invalid request origin headers");
  }
  let url: URL;
  try {
    authorityUrl(host);
    url = authorityUrl(forwardedHost ?? host);
  } catch {
    throw new ServiceError(400, "Invalid request origin headers");
  }
  url.protocol = `${forwardedProto ?? (production || req.socket?.encrypted ? "https" : "http")}:`;
  if (!origins.has(url.origin) && !(!production && isLoopback(url.hostname))) {
    throw new ServiceError(421, "Request origin is not allowed");
  }
  return url.origin;
}

/** Clerk receives a hostname derived from the same validated origin as its proxy. */
export function getClerkProxyHost(req: OriginRequest): string {
  return new URL(getTrustedAppOrigin(req)).hostname;
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next(new ServiceError(503, "Clerk proxy is unavailable"));
  }
  const proxy = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path: string) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}(?=/|$)`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const origin = getTrustedAppOrigin(req);
        const url = new URL(origin);
        proxyReq.setHeader("Clerk-Proxy-Url", `${origin}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);
        proxyReq.setHeader("X-Forwarded-Host", url.host);
        proxyReq.setHeader("X-Forwarded-Proto", url.protocol.slice(0, -1));
        // Do not promote an arbitrary client-supplied IP to trusted proxy data.
        proxyReq.setHeader("X-Forwarded-For", req.socket?.remoteAddress ?? "");
      },
      error: (_error, _req, res) => {
        if ("writeHead" in res && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Clerk proxy is unavailable" }));
        } else {
          res.destroy();
        }
      },
    },
  }) as RequestHandler;
  return (req, res, next) => {
    try {
      getTrustedAppOrigin(req);
    } catch (error) {
      next(error);
      return;
    }
    return proxy(req, res, next);
  };
}
