import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom" },
  resolve: {
    alias: {
      "@vaultdraw/api/testing": path.resolve(
        __dirname,
        "vaultdraw/testing/index.ts",
      ),
    },
  },
});
