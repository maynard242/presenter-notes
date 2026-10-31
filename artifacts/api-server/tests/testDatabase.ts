// Reject caller-supplied libpq options before either integration suite connects.
// Query parameters can override URL host/database despite a loopback hostname.
export function safeTestDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("TEST_DATABASE_URL must target an explicit loopback PostgreSQL database ending in _test without URL options");
  }
  return url;
}
