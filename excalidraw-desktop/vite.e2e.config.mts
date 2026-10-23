import path from "path";

import { defineConfig, mergeConfig } from "vite";

import { e2ePluginFixtures } from "./e2e/fixtures/pluginServer";
import { e2eThemeFixtures } from "./e2e/fixtures/themeServer";
import baseConfig from "./vite.config.mts";

// Production-style bundle of the Playwright harness (e2e.html). Serving
// bundled files is much lighter than the dev server, which sends the editor
// as thousands of unbundled modules on every page load.
const port = Number(process.env.E2E_PORT ?? 1421);

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [e2ePluginFixtures(), e2eThemeFixtures()],
    // Only this harness build exposes test hooks (useControlBridge).
    define: { "import.meta.env.VITE_APP_E2E": JSON.stringify("true") },
    build: {
      outDir: path.resolve(__dirname, `../.cache/e2e-dist-${port}`),
      emptyOutDir: true,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: path.resolve(__dirname, "e2e.html"),
      },
    },
    preview: {
      port,
      strictPort: true,
    },
  }),
);
