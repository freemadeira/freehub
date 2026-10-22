import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests of plain rules, run in Node: none needs the app's Vite plugins.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: [
      "src/**/*.test.ts",
      "btcmap/**/*.test.ts",
      "connector/**/*.test.ts",
      "notifier/**/*.test.ts",
    ],
  },
});
