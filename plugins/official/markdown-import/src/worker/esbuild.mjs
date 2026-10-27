/**
 * esbuild options for the layout code, for the plugin's build.mjs:
 *
 * ```js
 * import { workerBundleOptions, layoutBundleOptions } from "./src/worker/esbuild.mjs";
 * const worker = await esbuild.build({ ...workerBundleOptions(), write: false });
 * const source = worker.outputFiles[0].text;
 * await esbuild.build({
 *   ...layoutBundleOptions(source),
 *   entryPoints: ["src/main.ts"], outfile: "dist/main.js", ...
 * });
 * ```
 *
 * Both map `@excalidraw/common` to src/layout/excalidrawCommonShim.ts so the
 * editor's `wrapText` bundles without the rest of the editor (the real index
 * loads modules that touch `document`, which has no place in a worker).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shim = resolve(here, "../layout/excalidrawCommonShim.ts");

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  alias: { "@excalidraw/common": shim },
  define: { "import.meta.env.MODE": '"production"' },
  logLevel: "warning",
};

/** The worker bundle (one file, no exports); its text becomes `__MD_WORKER_SOURCE__`. */
export const workerBundleOptions = () => ({
  ...common,
  entryPoints: [resolve(here, "entry.ts")],
  format: "iife",
  minify: true,
});

/** Options the plugin's main bundle adds so `createLayoutClient` finds the worker source. */
export const layoutBundleOptions = (workerSource) => ({
  ...common,
  define: {
    ...common.define,
    __MD_WORKER_SOURCE__: JSON.stringify(workerSource),
  },
});
