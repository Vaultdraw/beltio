/**
 * Builds the graph plugin into dist/ (plugin.toml, main.js, README.md):
 *   1. the layout worker (src/layout.worker.ts) is bundled into one self-contained string,
 *   2. src/main.ts is bundled with that string injected as the global `__GRAPH_WORKER_SOURCE__`
 *      (the app's CSP allows a worker only from a blob: URL), and `graph.css` as a text import,
 *   3. `vaultdraw-plugin check` runs on dist/.
 * Run from anywhere: `node plugins/official/graph/build.mjs [--no-check]`.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../..");
const dist = path.join(root, "dist");
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [repo, root] }));
const SHARED = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@vaultdraw/api",
];
const common = {
  bundle: true,
  target: "es2022",
  logLevel: "warning",
  define: { "import.meta.env.MODE": '"production"' },
};

const worker = await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "src/layout.worker.ts")],
  format: "iife",
  minify: true,
  write: false,
});
const workerSrc = worker.outputFiles[0].text;

const main = await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "src/main.ts")],
  format: "esm",
  platform: "browser",
  external: SHARED,
  loader: { ".css": "text" },
  define: { ...common.define, __GRAPH_WORKER_SOURCE__: JSON.stringify(workerSrc) },
  write: false,
  minify: false,
});

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "main.js"), main.outputFiles[0].text);
for (const f of ["plugin.toml", "README.md"]) {
  copyFileSync(path.join(root, f), path.join(dist, f));
}
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `graph: main.js ${kb(statSync(path.join(dist, "main.js")).size)} (worker string ${kb(workerSrc.length)})`,
);

if (!process.argv.includes("--no-check")) {
  const cli = path.join(repo, "sdk/cli/bin/vaultdraw-plugin.mjs");
  const r = spawnSync(process.execPath, [cli, "check", dist], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}
