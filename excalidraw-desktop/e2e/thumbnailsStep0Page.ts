import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { build } from "vite";

import type { Page } from "@playwright/test";

// The thumbnail measurement page (e2e/thumbnailsStep0.html) is production-built
// with the e2e vite config and served through page.route under /__step0/, so
// the specs that need the renderer without a vault share one harness.

const desktopDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const outDir = path.join(os.tmpdir(), `vaultdraw-step0-${process.pid}`);
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export const buildStep0 = () =>
  build({
    configFile: path.join(desktopDir, "vite.e2e.config.mts"),
    root: desktopDir,
    base: "/__step0/",
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(desktopDir, "e2e/thumbnailsStep0.html"),
      },
    },
  });

/** Remove the build dir (about 21 MB per worker); use in `test.afterAll`, which runs after failures too. */
export const cleanupStep0 = () => {
  rmSync(outDir, { recursive: true, force: true });
};

export const openStep0 = async (page: Page, origin: string) => {
  await page.route(`${origin}/__step0/**`, async (route) => {
    const file = path.join(
      outDir,
      decodeURIComponent(new URL(route.request().url()).pathname).replace(
        /^\/__step0\//,
        "",
      ),
    );
    try {
      await route.fulfill({
        body: readFileSync(file),
        contentType: MIME[path.extname(file)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${origin}/__step0/e2e/thumbnailsStep0.html`);
  await page.waitForFunction(() => Boolean((window as any).__step0));
};
