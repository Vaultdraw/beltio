/**
 * Builds the formula plugin into dist/ (plugin.toml, main.js, worker-src.js, README.md):
 *   1. the MathJax worker (src/formula.worker.ts) is bundled into one self-contained string, written to
 *      dist/worker-src.js (`export default "..."`), which main.js imports on the first render only
 *      (the app's CSP allows a worker only from a blob: URL),
 *   2. src/main.tsx is bundled with `FormulaDialog.css` as a text import,
 *   3. `vaultdraw-plugin check` runs on dist/.
 * Run from anywhere: `node plugins/official/formula/build.mjs [--no-check]`.
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
  entryPoints: [path.join(root, "src/formula.worker.ts")],
  format: "iife",
  minify: true,
  write: false,
});
const workerSrc = worker.outputFiles[0].text;

const main = await esbuild.build({
  ...common,
  entryPoints: [path.join(root, "src/main.tsx")],
  format: "esm",
  platform: "browser",
  external: [...SHARED, "./worker-src.js"],
  jsx: "automatic",
  charset: "utf8",
  loader: { ".css": "text" },
  define: { ...common.define, __FORMULA_WORKER_FILE__: '"./worker-src.js"' },
  write: false,
  minify: false,
});

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "main.js"), main.outputFiles[0].text);
// The worker text lives in its own module, imported on the first render only.
writeFileSync(
  path.join(dist, "worker-src.js"),
  `export default ${JSON.stringify(workerSrc)};\n`,
);
for (const f of ["plugin.toml", "README.md"]) {
  copyFileSync(path.join(root, f), path.join(dist, f));
}
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `formula: main.js ${kb(statSync(path.join(dist, "main.js")).size)} + worker-src.js ${kb(statSync(path.join(dist, "worker-src.js")).size)}`,
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
