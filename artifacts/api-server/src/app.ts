import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
  getTrustedAppOrigin,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import mcpRouter from "./mcp";
import { logger } from "./lib/logger";
import { serviceErrorHandler } from "./lib/errors";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
      // Error messages/stacks can contain request input or SQL parameters.
      err() {
        return { type: "Error" };
      },
    },
  }),
);

// Reject malformed/unconfigured origins before Clerk derives a key or proxies
// any request with server credentials. Forwarded headers never establish trust.
app.use((req, _res, next) => {
  getTrustedAppOrigin(req);
  next();
});
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// CORS: lock down by default. Set CORS_ORIGIN to a comma-separated allowlist
// (e.g. "https://app.example.com") in production. Falls back to same-origin
// only when unset, which is correct for single-domain deployments (Vercel,
// Replit) where the SPA and API share the host.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : false;
app.use(cors({ credentials: true, origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", mcpRouter);
app.use("/api", router);
app.use(serviceErrorHandler);
// Never expose PostgreSQL errors, SQL parameters or stack traces to clients.
const unexpectedErrorHandler: ErrorRequestHandler = (_error, _req, res, next) => {
  if (res.headersSent) { next(_error); return; }
  logger.error("API request failed");
  res.status(500).json({ error: "Unable to complete request" });
};
app.use(unexpectedErrorHandler);

if (process.env.AGENT_API_KEY && !process.env.AGENT_OWNER_USER_ID) {
  logger.warn(
    "AGENT_API_KEY is set but AGENT_OWNER_USER_ID is not. Agent REST endpoint and MCP tools will fail-closed until AGENT_OWNER_USER_ID is configured.",
  );
}

export default app;
