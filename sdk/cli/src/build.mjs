/**
 * `vaultdraw-plugin build [dir] [--watch]`: bundles a TypeScript (or plain) project into
 * `dist/` with esbuild. esbuild is the one dependency; it is loaded only here, from the
 * project first and then from next to this command.
 *
 * `dist/` holds `plugin.toml` (copied unchanged), the bundle at the manifest's `main`
 * path (default `main.js`), README*, LICENSE* and `assets/`. `check dist` and
 * `package dist` work on it, and `dev` mirrors it into the plugins folder.
 *
 * The entry is `entry` in the plugin.toml table `[x-build]` (the app ignores `x-*`
 * tables; a plain `[build]` would be an unknown key), else src/main.ts, src/main.tsx,
 * src/main.js.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { EnvError } from "./dirs.mjs";
import { listFiles, writeIfChanged } from "./files.mjs";
import { isSafeRelPath } from "./manifest.mjs";
import { SHARED_SPECIFIERS } from "./shared.mjs";
import { parseToml } from "./toml.mjs";

const WARN_BYTES = 100 * 1024;
const DEFAULT_ENTRIES = ["src/main.ts", "src/main.tsx", "src/main.js"];

const isFile = (/** @type {string} */ p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * The source entry of a project, or null when there is none.
 * @param {string} root
 * @returns {string | null} a path relative to root
 */
export function findEntry(root) {
  const manifest = path.join(root, "plugin.toml");
  if (!isFile(manifest)) {
    return null;
  }
  /** @type {any} */
  let doc = {};
  try {
    doc = parseToml(readFileSync(manifest, "utf8"));
  } catch {
    return null;
  }
  const declared = doc["x-build"]?.entry;
  if (typeof declared === "string" && isSafeRelPath(declared)) {
    return declared;
  }
  return DEFAULT_ENTRIES.find((e) => isFile(path.join(root, e))) ?? null;
}

/**
 * Whether `dev` should build this folder first: it has a source entry and its `main`
 * file does not exist next to plugin.toml (a plain-JS plugin with src/main.js is left alone).
 * @param {string} root
 */
export function isBuildProject(root) {
  if (!findEntry(root)) {
    return false;
  }
  try {
    const { main } = parseToml(
      readFileSync(path.join(root, "plugin.toml"), "utf8"),
    );
    return !(
      typeof main === "string" &&
      isSafeRelPath(main) &&
      isFile(path.join(root, ...main.split("/")))
    );
  } catch {
    return false;
  }
}

/** Loads esbuild from the project, then from the command's own location. */
async function loadEsbuild(/** @type {string} */ root) {
  for (const from of [path.join(root, "noop.js"), import.meta.url]) {
    let file;
    try {
      file = createRequire(from).resolve("esbuild");
    } catch {
      continue;
    }
    const mod = await import(pathToFileURL(file).href);
    return mod.build ? mod : mod.default;
  }
  throw new EnvError(
    "esbuild was not found. Install it with: npm install --save-dev esbuild",
  );
}

/**
 * The files `build` copies next to the bundle (relative to the project).
 * @param {string} root
 */
function staticFiles(root) {
  return listFiles(root).filter(
    (f) =>
      f === "plugin.toml" ||
      (!f.includes("/") && /^(readme|license)/i.test(f)) ||
      f.startsWith("assets/"),
  );
}

/** @param {string} root @param {string} dist */
function copyStatic(root, dist) {
  for (const f of staticFiles(root)) {
    writeIfChanged(
      path.join(dist, ...f.split("/")),
      readFileSync(path.join(root, ...f.split("/"))),
    );
  }
}

const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;

/**
 * @param {string} root
 * @param {string} entry
 * @returns {{ outfile: string, options: Record<string, unknown> }}
 */
function buildOptions(root, entry) {
  const doc = parseToml(readFileSync(path.join(root, "plugin.toml"), "utf8"));
  const main =
    typeof doc.main === "string" && isSafeRelPath(doc.main)
      ? doc.main
      : "main.js";
  const outfile = path.join(root, "dist", ...main.split("/"));
  return {
    outfile,
    options: {
      entryPoints: [path.join(root, entry)],
      outfile,
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "browser",
      external: [...SHARED_SPECIFIERS],
      jsx: "automatic",
      jsxImportSource: "react",
      minify: false,
      metafile: true,
      logLevel: "error",
    },
  };
}

/** @param {any} result @param {string} root @param {(s: string) => void} out @param {(s: string) => void} err */
function report(result, root, out, err) {
  for (const [file, info] of Object.entries(
    /** @type {Record<string, {bytes: number}>} */ (result.metafile.outputs),
  )) {
    const rel = path
      .relative(root, path.resolve(root, file))
      .split(path.sep)
      .join("/");
    out(`${rel} ${kb(info.bytes)}`);
    if (info.bytes > WARN_BYTES) {
      err(
        `warning: ${rel} is over 100 KB; bundle less or load parts lazily to keep loading fast`,
      );
    }
  }
}

/**
 * One build into `<root>/dist`.
 * @param {string} root
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<number>} the exit code
 */
export async function buildProject(root, out, err) {
  const entry = findEntry(root);
  if (!entry) {
    err(
      `No source entry found in ${root}: add src/main.ts (or src/main.tsx), or set entry under [x-build] in plugin.toml.`,
    );
    return 1;
  }
  const esbuild = await loadEsbuild(root);
  const { options } = buildOptions(root, entry);
  const dist = path.join(root, "dist");
  // dist is build output only: start clean so a removed asset never lingers in the package.
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  try {
    const result = await esbuild.build(options);
    copyStatic(root, dist);
    report(result, root, out, err);
  } catch (e) {
    // esbuild already printed the messages (logLevel "error").
    if (/** @type {any} */ (e)?.errors) {
      return 1;
    }
    throw e;
  }
  return 0;
}

/**
 * Builds once, then rebuilds on every change until `stop()`. Resolves after the first
 * build with `null` when it failed.
 * @param {string} root
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<{ stop: () => Promise<void> } | null>}
 */
export async function watchProject(root, out, err) {
  const entry = findEntry(root);
  if (!entry) {
    err(
      `No source entry found in ${root}: add src/main.ts (or src/main.tsx), or set entry under [x-build] in plugin.toml.`,
    );
    return null;
  }
  const esbuild = await loadEsbuild(root);
  const { options, outfile } = buildOptions(root, entry);
  const dist = path.join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  // esbuild's watcher reports one rebuild right after it starts; only a changed bundle is news.
  /** @type {Buffer | null} */
  let last = null;
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "vaultdraw-report",
        setup(/** @type {any} */ b) {
          b.onEnd((/** @type {any} */ r) => {
            if (r.errors.length > 0) {
              err(`${stamp()} build failed`);
              return;
            }
            /** @type {Buffer} */
            let now;
            try {
              copyStatic(root, dist);
              now = readFileSync(outfile);
            } catch {
              // a file vanished mid-save; the next rebuild retries
              return;
            }
            if (last && now.equals(last)) {
              return;
            }
            if (last) {
              out(`${stamp()} rebuilt`);
            }
            last = now;
            report(r, root, out, err);
          });
        },
      },
    ],
  });
  try {
    await ctx.rebuild();
  } catch {
    await ctx.dispose();
    return null;
  }
  await ctx.watch();
  // esbuild watches the bundle's inputs; the manifest, README and assets are ours.
  const watcher = watch(root, { recursive: true }, (_e, name) => {
    const n = name ? String(name).split(path.sep).join("/") : "";
    if (
      n === "plugin.toml" ||
      /^(readme|license)[^/]*$/i.test(n) ||
      n.startsWith("assets/")
    ) {
      try {
        copyStatic(root, dist);
      } catch {
        // a file vanished mid-save; the next event retries
      }
    }
  });
  return {
    async stop() {
      watcher.close();
      await ctx.dispose();
    },
  };
}

/**
 * @param {string | undefined} dir
 * @param {{ watch?: boolean }} opts
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<number>} the exit code
 */
export async function runBuild(dir, opts, out, err) {
  const root = path.resolve(dir ?? ".");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new EnvError(`Folder not found: ${dir}`);
  }
  if (!opts.watch) {
    return buildProject(root, out, err);
  }
  const w = await watchProject(root, out, err);
  if (!w) {
    return 1;
  }
  out(`Watching ${root}. Press Ctrl+C to stop.`);
  await new Promise((resolve) => {
    const done = () => resolve(undefined);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await w.stop();
  return 0;
}
