/**
 * Builds the table plugin into dist/ (plugin.toml, main.js, README.md): src/main.ts bundled
 * with the API external (the app's import map provides it).
 * Run from anywhere: `node plugins/official/table/build.mjs [--no-check]`.
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

const main = await esbuild.build({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: SHARED,
  write: false,
  minify: true,
});

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "main.js"), main.outputFiles[0].text);
for (const f of ["plugin.toml", "README.md"]) {
  copyFileSync(path.join(root, f), path.join(dist, f));
}
console.log(
  `table: main.js ${(
    statSync(path.join(dist, "main.js")).size / 1024
  ).toFixed(1)} KB`,
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
