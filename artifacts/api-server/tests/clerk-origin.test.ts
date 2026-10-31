import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingHttpHeaders } from "node:http";

const proxy = vi.hoisted(() => ({
  options: undefined as any,
  handler: vi.fn((_req: any, _res: any, next: any) => next()),
}));
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn((options) => {
    proxy.options = options;
    return proxy.handler;
  }),
}));
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
  getTrustedAppOrigin,
} from "../src/middlewares/clerkProxyMiddleware";

const canonical = "https://presenter-notes-api-server.vercel.app";
const request = (headers: IncomingHttpHeaders) => ({ headers });
function expectStatus(headers: IncomingHttpHeaders, statusCode: number) {
  expect(() => getTrustedAppOrigin(request(headers))).toThrow(
    expect.objectContaining({ statusCode }),
  );
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGINS", canonical);
  vi.stubEnv("REPLIT_DEV_DOMAIN", "");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_origin-regression-only");
  proxy.options = undefined;
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit application origin boundary", () => {
  it("uses the configured canonical HTTPS origin for direct requests", () => {
    expect(getTrustedAppOrigin(request({ host: new URL(canonical).host }))).toBe(canonical);
    expect(getClerkProxyHost(request({ host: new URL(canonical).host }))).toBe(new URL(canonical).hostname);
  });
  it("supports an explicitly allowed public origin behind an internal proxy", () => {
    expect(getTrustedAppOrigin(request({
      host: "internal.vercel.local",
      "x-forwarded-host": new URL(canonical).host,
      "x-forwarded-proto": "https",
    }))).toBe(canonical);
  });
  it("allows only exact configured origins, including scheme and port", () => {
    vi.stubEnv("APP_ORIGINS", `${canonical},https://notes.example.com:8443`);
    expect(getTrustedAppOrigin(request({ host: "notes.example.com:8443" }))).toBe("https://notes.example.com:8443");
    expectStatus({ host: "notes.example.com" }, 421);
    expectStatus({ host: new URL(canonical).host, "x-forwarded-proto": "http" }, 421);
    expectStatus({ host: `${new URL(canonical).host}.evil.example` }, 421);
  });
  it("does not fall back to an allowed Host after a spoofed forwarded host", () => {
    expectStatus({ host: new URL(canonical).host, "x-forwarded-host": "evil.example" }, 421);
  });
  it.each([
    { "x-forwarded-host": "evil.example, presenter-notes-api-server.vercel.app" },
    { "x-forwarded-host": ["presenter-notes-api-server.vercel.app"] },
    { "x-forwarded-proto": "https,http" },
    { "x-forwarded-proto": ["https"] },
    { "x-forwarded-proto": "javascript" },
    { "x-forwarded-proto": "HTTPS" },
    { "x-forwarded-host": "https://presenter-notes-api-server.vercel.app" },
    { "x-forwarded-host": "user@presenter-notes-api-server.vercel.app" },
    { "x-forwarded-host": "presenter-notes-api-server.vercel.app/path" },
    { "x-forwarded-host": "presenter-notes-api-server.vercel.app?query" },
    { "x-forwarded-host": "presenter-notes-api-server.vercel.app#hash" },
    { "x-forwarded-host": "presenter-notes-api-server.vercel.app\\evil" },
    { "x-forwarded-host": " presenter-notes-api-server.vercel.app " },
    { "x-forwarded-host": "" },
    { host: "bad host" },
    { host: "presenter-notes-api-server.vercel.app:99999" },
    { host: "presenter-notes-api-server.vercel.app," },
  ])("rejects malformed/multivalue headers safely: %j", (headers) => {
    expectStatus({ host: new URL(canonical).host, ...headers }, 400);
  });
  it("rejects a missing host", () => expectStatus({}, 400));
  it.each(["", "http://notes.example.com", "https://user:pass@notes.example.com", "https://notes.example.com/path", "https://notes.example.com?query", "https://*.example.com", `${canonical},`])(
    "fails closed on missing/invalid production APP_ORIGINS: %s", (origins) => {
      vi.stubEnv("APP_ORIGINS", origins);
      expectStatus({ host: new URL(canonical).host }, 503);
    },
  );
  it("does not implicitly trust Vercel or production Replit metadata", () => {
    vi.stubEnv("APP_ORIGINS", "");
    vi.stubEnv("VERCEL_URL", "evil.example");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "project.replit.dev");
    expectStatus({ host: "evil.example" }, 503);
    expectStatus({ host: "project.replit.dev" }, 503);
  });
  it.each(["localhost:5173", "127.0.0.1:3000", "[::1]:5173"])("allows loopback HTTP in development: %s", (host) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGINS", "");
    expect(getTrustedAppOrigin(request({ host }))).toBe(`http://${host}`);
  });
  it("requires explicit origins for non-loopback development hosts", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGINS", "");
    expectStatus({ host: "attacker.local" }, 421);
    vi.stubEnv("APP_ORIGINS", "http://192.168.1.2:5173");
    expectStatus({ host: "192.168.1.2:5173" }, 503);
  });
  it("supports only the validated exact Replit development domain", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGINS", "");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "project.replit.dev");
    expect(getTrustedAppOrigin(request({ host: "project.replit.dev", "x-forwarded-proto": "https" }))).toBe("https://project.replit.dev");
    expectStatus({ host: "other.replit.dev", "x-forwarded-proto": "https" }, 421);
    vi.stubEnv("REPLIT_DEV_DOMAIN", "https://project.replit.dev/path");
    expectStatus({ host: "project.replit.dev", "x-forwarded-proto": "https" }, 503);
  });
});

describe("Clerk proxy", () => {
  it("never creates an upstream request or forwards a secret for a rejected origin", () => {
    const middleware = clerkProxyMiddleware();
    const next = vi.fn();
    middleware(request({ host: "evil.example" }) as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 421 }));
    expect(proxy.handler).not.toHaveBeenCalled();
  });
  it("forwards the secret only with the validated canonical proxy URL", () => {
    const middleware = clerkProxyMiddleware();
    const req = request({ host: "internal.vercel.local", "x-forwarded-host": new URL(canonical).host, "x-forwarded-proto": "https" });
    middleware(req as any, {} as any, vi.fn());
    expect(proxy.handler).toHaveBeenCalledOnce();
    const upstream = { setHeader: vi.fn() };
    proxy.options.on.proxyReq(upstream, req);
    expect(upstream.setHeader).toHaveBeenCalledWith("Clerk-Proxy-Url", `${canonical}${CLERK_PROXY_PATH}`);
    expect(upstream.setHeader).toHaveBeenCalledWith("Clerk-Secret-Key", "sk_test_origin-regression-only");
    expect(proxy.options.pathRewrite(`${CLERK_PROXY_PATH}/v1/client`)).toBe("/v1/client");
    expect(proxy.options.pathRewrite("/v1/client")).toBe("/v1/client");
  });
  it("fails safely when no secret is configured", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const next = vi.fn();
    clerkProxyMiddleware()(request({ host: new URL(canonical).host }) as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
    expect(proxy.handler).not.toHaveBeenCalled();
  });
  it("does not proxy Clerk development instances", () => {
    vi.stubEnv("NODE_ENV", "development");
    const next = vi.fn();
    clerkProxyMiddleware()(request({ host: "localhost:3000" }) as any, {} as any, next);
    expect(next).toHaveBeenCalledWith();
    expect(proxy.handler).not.toHaveBeenCalled();
  });
});
