import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["artifacts/api-server/tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
