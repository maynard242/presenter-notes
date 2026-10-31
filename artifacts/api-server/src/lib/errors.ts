import type { ErrorRequestHandler } from "express";

/** Expected, safe-to-display failure; never put SQL or note bodies in its message. */
export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const serviceErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof ServiceError) {
    if (err.retryAfterSeconds) res.set("Retry-After", String(err.retryAfterSeconds));
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body exceeds the 1 MiB limit" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON request" });
    return;
  }
  next(err);
};
