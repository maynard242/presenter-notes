import { writeFile } from "node:fs/promises";

// Orval emits colliding type/schema barrel exports in split Zod mode.
// The runtime schemas are the only public API of this package.
await writeFile(
  new URL("../lib/api-zod/src/index.ts", import.meta.url),
  'export * from "./generated/api";\n',
);
