// A real Playwright run with the real e2e-server.mjs and a tiny HTTP server (no browser):
// before the fix it printed "1 passed" and never exited.
import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT;
export default defineConfig({
  testDir: ".",
  testMatch: "*.pwspec.mjs",
  reporter: [["list"]],
  outputDir: process.env.PW_OUTPUT_DIR,
  webServer: {
    command: "node ../../e2e-server.mjs",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
