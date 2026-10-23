/**
 * `vaultdraw-plugin dev <dir>`: keeps a copy of the plugin in the app's plugins folder.
 * The app's own file watcher reloads it. This never edits the user's config.toml.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  watch,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { EnvError, resolveDirs } from "./dirs.mjs";
import { isExcluded, listFiles, writeIfChanged } from "./files.mjs";
import {
  isSafeRelPath,
  isValidPluginId,
  validateManifestText,
} from "./manifest.mjs";
import { parseToml, TomlError } from "./toml.mjs";

/** Raised for a refusal that exits with code 1. */
export class Refusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "Refusal";
  }
}

/**
 * Adds `dev = true` at the top level (before the first table), replacing an existing `dev` line.
 * @param {string} text
 */
export function withDevTrue(text) {
  const lines = text.split("\n");
  let end = lines.findIndex((l) => /^\s*\[/.test(l));
  if (end < 0) {
    end = lines.length;
  }
  const head = lines.slice(0, end);
  const at = head.findIndex((l) => /^\s*dev\s*=/.test(l));
  if (at >= 0) {
    head[at] = "dev = true";
    return [...head, ...lines.slice(end)].join("\n");
  }
  let last = head.length;
  while (last > 0 && head[last - 1].trim() === "") {
    last--;
  }
  return [...head.slice(0, last), "dev = true", ...lines.slice(last)].join(
    "\n",
  );
}

/**
 * Resolves the config folder like the app, creates it only when it was named explicitly
 * and returns its real path.
 * @param {{ configDir?: string, env: Record<string, string | undefined> }} o
 */
export function resolveConfigDir({ configDir, env }) {
  let dir;
  let explicit = false;
  if (configDir) {
    dir = path.resolve(configDir);
    explicit = true;
  } else {
    const d = resolveDirs(env);
    dir = d.config;
    explicit = d.configOverridden;
  }
  if (!existsSync(dir)) {
    if (!explicit) {
      throw new EnvError(
        `The Vaultdraw config folder ${dir} does not exist. Start Vaultdraw once, or pass --config-dir.`,
      );
    }
    mkdirSync(dir, { recursive: true });
  }
  return realpathSync(dir);
}

/**
 * @param {string} pluginsDir
 * @param {string} id
 * @returns {string | null} the folder of an installed copy that is not a dev copy
 */
export function findInstalledNonDev(pluginsDir, id) {
  if (!existsSync(pluginsDir)) {
    return null;
  }
  for (const e of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isSymbolicLink()) {
      continue;
    }
    const folder = path.join(pluginsDir, e.name);
    const manifest = path.join(folder, "plugin.toml");
    let doc = null;
    try {
      doc = parseToml(readFileSync(manifest, "utf8"));
    } catch (err) {
      if (
        !(err instanceof TomlError) &&
        /** @type {any} */ (err)?.code !== "ENOENT"
      ) {
        throw err;
      }
    }
    const nonEmpty = () => {
      try {
        return readdirSync(folder).length > 0;
      } catch {
        return false;
      }
    };
    if (doc) {
      if (doc.id === id && doc.dev !== true) {
        return folder;
      }
    } else if (e.name === id && nonEmpty()) {
      // A folder with our name but no readable manifest: not ours to overwrite.
      return folder;
    }
  }
  return null;
}

const timeStamp = () => new Date().toTimeString().slice(0, 8);

/**
 * One copy pass. Returns the names written and removed.
 * @param {string} src
 * @param {string} dest
 * @returns {{ written: string[], removed: string[] }}
 */
export function syncOnce(src, dest) {
  const manifestFile = path.join(src, "plugin.toml");
  if (!existsSync(manifestFile)) {
    throw new Refusal("plugin.toml was not found in the plugin folder");
  }
  const manifestText = readFileSync(manifestFile, "utf8");
  let doc;
  try {
    doc = parseToml(manifestText);
  } catch (e) {
    throw new Refusal(
      `plugin.toml is not valid TOML (${/** @type {Error} */ (e).message})`,
    );
  }
  const main = doc.main;
  if (typeof main !== "string" || !isSafeRelPath(main)) {
    throw new Refusal("plugin.toml needs a valid main path");
  }
  if (!existsSync(path.join(src, ...main.split("/")))) {
    throw new Refusal(`The main file '${main}' does not exist yet`);
  }
  const files = listFiles(src);
  const others = files.filter((f) => f !== "plugin.toml" && f !== main);
  /** @type {string[]} */
  const written = [];
  mkdirSync(dest, { recursive: true });
  const copy = (rel, bytes) => {
    if (writeIfChanged(path.join(dest, ...rel.split("/")), bytes)) {
      written.push(rel);
    }
  };
  for (const f of others) {
    copy(f, readFileSync(path.join(src, ...f.split("/"))));
  }
  const removed = removeStale(dest, new Set(files));
  copy("plugin.toml", withDevTrue(manifestText));
  if (files.includes(main)) {
    copy(main, readFileSync(path.join(src, ...main.split("/"))));
  }
  return { written, removed };
}

/**
 * Removes files (and then empty folders) inside `dest` that are not in `keep`.
 * @param {string} dest
 * @param {Set<string>} keep
 * @returns {string[]}
 */
function removeStale(dest, keep) {
  /** @type {string[]} */
  const removed = [];
  /** @param {string} rel */
  const walk = (rel) => {
    const abs = path.join(dest, rel);
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(r);
        try {
          rmdirSync(path.join(dest, r));
        } catch {
          // not empty
        }
      } else if (
        !keep.has(r) &&
        !(e.name.startsWith(".") && e.name.endsWith(".tmp"))
      ) {
        unlinkSync(path.join(dest, r));
        removed.push(r);
      }
    }
  };
  walk("");
  return removed;
}

/** @param {string[]} names */
const summarize = (names) =>
  names.length > 3
    ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
    : names.join(", ");

/**
 * The environment for an isolated app instance. Nothing is created.
 * @param {{ configDir?: string }} o
 * @returns {string[]} `NAME=value` lines
 */
export function printEnvLines({ configDir }) {
  const base = path.join(
    os.tmpdir(),
    `vd-dev-${randomBytes(3).toString("hex")}`,
  );
  const q = (v) =>
    /^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replaceAll("'", "'\\''")}'`;
  return [
    `VAULTDRAW_CONFIG_DIR=${q(
      configDir ? path.resolve(configDir) : path.join(base, "config"),
    )}`,
    `VAULTDRAW_STATE_DIR=${q(path.join(base, "state"))}`,
  ];
}

const NEXT_STEPS =
  "In Vaultdraw: Cmd+P, Plugins: Reload plugin list; then Settings, Plugins, enable the plugin. After that, saves reload it by itself.";

/**
 * @param {string | undefined} dir
 * @param {{ configDir?: string, once?: boolean, printEnv?: boolean, env: Record<string, string | undefined> }} opts
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<number>} the exit code
 */
export async function runDev(dir, opts, out, err) {
  if (opts.printEnv) {
    for (const l of printEnvLines({ configDir: opts.configDir })) {
      out(l);
    }
    return 0;
  }
  if (!dir) {
    throw new EnvError("Missing the plugin folder: vaultdraw-plugin dev <dir>");
  }
  let src = path.resolve(dir);
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new EnvError(`Folder not found: ${dir}`);
  }
  // A project with a source entry (TypeScript) is built into dist/, and dist/ is mirrored.
  /** @type {{ stop: () => Promise<void> } | null} */
  let builder = null;
  const { isBuildProject, buildProject, watchProject } = await import(
    "./build.mjs"
  );
  if (isBuildProject(src)) {
    const project = src;
    if (opts.once) {
      if ((await buildProject(project, out, err)) !== 0) {
        return 1;
      }
    } else {
      builder = await watchProject(project, out, err);
      if (!builder) {
        return 1;
      }
    }
    src = path.join(project, "dist");
  }
  try {
    return await mirror(dir, src, opts, out, err);
  } finally {
    await builder?.stop();
  }
}

/**
 * @param {string} dir
 * @param {string} src
 * @param {{ configDir?: string, once?: boolean, env: Record<string, string | undefined> }} opts
 * @param {(s: string) => void} out
 * @param {(s: string) => void} err
 * @returns {Promise<number>}
 */
async function mirror(dir, src, opts, out, err) {
  const manifestFile = path.join(src, "plugin.toml");
  if (!existsSync(manifestFile)) {
    err(
      `There is no plugin.toml in ${src}. Run vaultdraw-plugin init to create a plugin.`,
    );
    return 1;
  }
  const text = readFileSync(manifestFile, "utf8");
  let doc;
  try {
    doc = parseToml(text);
  } catch (e) {
    err(`plugin.toml is not valid TOML (${/** @type {Error} */ (e).message}).`);
    return 1;
  }
  const id = doc.id;
  if (typeof id !== "string" || !isValidPluginId(id)) {
    err(
      "plugin.toml needs a valid id (a-z, 0-9 and -, 2 to 39 characters). Run vaultdraw-plugin check.",
    );
    return 1;
  }
  const problems = validateManifestText(text).errors.filter(
    (e) => e.code !== "dev-true",
  );
  if (problems.length > 0) {
    err(
      `Note: plugin.toml has ${problems.length} problem${
        problems.length === 1 ? "" : "s"
      } the app will report. Run vaultdraw-plugin check ${dir}.`,
    );
  }

  const config = resolveConfigDir({ configDir: opts.configDir, env: opts.env });
  const pluginsDir = path.join(config, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  const realPlugins = realpathSync(pluginsDir);
  const dest = path.join(realPlugins, id);
  const clash = findInstalledNonDev(realPlugins, id);
  if (clash) {
    err(
      `The plugin '${id}' is already installed in ${clash}. Copying over it would replace your installed copy. ` +
        "Uninstall it first in Settings, Plugins, then run this again.",
    );
    return 1;
  }
  if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
    err(`${dest} is a symbolic link; refusing to write through it.`);
    return 1;
  }
  const realSrc = realpathSync(src);
  if (
    realSrc === dest ||
    realSrc.startsWith(dest + path.sep) ||
    dest.startsWith(realSrc + path.sep)
  ) {
    err(
      "The plugin folder and the installed copy overlap; use a source folder outside the plugins folder.",
    );
    return 1;
  }

  /** @returns {boolean} whether it worked */
  const sync = (first) => {
    try {
      const { written, removed } = syncOnce(src, dest);
      if (first) {
        out(`Installed ${id} in ${dest}`);
      }
      const parts = [];
      if (written.length) {
        parts.push(`copied ${summarize(written)}`);
      }
      if (removed.length) {
        parts.push(`removed ${summarize(removed)}`);
      }
      if (!first && parts.length) {
        out(`${timeStamp()} ${parts.join("; ")}`);
      }
      return true;
    } catch (e) {
      if (e instanceof Refusal) {
        err(`${timeStamp()} ${e.message}`);
        return false;
      }
      throw e;
    }
  };

  if (!sync(true)) {
    return 1;
  }
  out(NEXT_STEPS);
  if (opts.once) {
    return 0;
  }

  out(`Watching ${src}. Press Ctrl+C to stop.`);
  const { devLogPath, tailLog } = await import("./devlog.mjs");
  const logFile = devLogPath(opts.env, id);
  const stopTail = logFile ? tailLog(logFile, out) : () => {};
  if (logFile) {
    out(`Dev log: ${logFile} (new lines are shown here)`);
  }
  await new Promise((resolve) => {
    let timer;
    let running = false;
    let again = false;
    const run = () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        // The id is fixed for the session: a changed id needs a restart.
        const now = parseToml(readFileSync(manifestFile, "utf8"));
        if (now.id !== id) {
          err(
            `${timeStamp()} The plugin id changed; stop and start dev again.`,
          );
        } else {
          sync(false);
        }
      } catch (e) {
        err(`${timeStamp()} ${/** @type {Error} */ (e).message}`);
      } finally {
        running = false;
        if (again) {
          again = false;
          timer = setTimeout(run, 100);
        }
      }
    };
    const watcher = watch(src, { recursive: true }, (_event, name) => {
      if (
        name &&
        path.normalize(String(name)).split(path.sep).some(isExcluded)
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(run, 100);
    });
    const stop = () => {
      clearTimeout(timer);
      stopTail();
      watcher.close();
      resolve(undefined);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
