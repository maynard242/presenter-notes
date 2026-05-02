import type { Request } from "express";
import { safeEqual } from "./safeEqual";

/**
 * Extract a bearer token from `Authorization: Bearer ...` or `X-API-Key: ...`.
 * Body fields are intentionally not consulted — secrets in bodies leak into
 * logs and APM tools.
 */
export function extractAgentToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const xHeader = req.headers["x-api-key"];
  if (typeof xHeader === "string" && xHeader.trim()) return xHeader.trim();
  return null;
}

export function checkAgentApiKey(
  req: Request,
  expected: string,
  bodyKey?: string,
): boolean {
  if (!expected) return false;
  const token = extractAgentToken(req) ?? bodyKey ?? null;
  if (!token) return false;
  return safeEqual(token, expected);
}
