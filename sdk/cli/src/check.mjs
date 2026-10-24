/** `vaultdraw-plugin check <dir> [--json]`: static checks of a plugin folder. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { EnvError } from "./dirs.mjs";
import { isSafeRelPath, validateManifestText } from "./manifest.mjs";
import { compareSemver } from "./semver.mjs";
import { SHARED_SPECIFIERS } from "./shared.mjs";
import { parseToml } from "./toml.mjs";

const BUNDLE_WARN_BYTES = 100 * 1024;
const MAX_SCANNED_FILES = 200;

/**
 * The app version that first shipped each part of the API, for the `min-app-low`
 * warning. Best effort: it only looks for `ctx.<area>` in the code. A test keeps the
 * revision equal to `vaultdraw.minApp` in sdk/api/package.json.
 */
export const FIRST_APP_WITH_API = "0.1.2";
export const API_AREAS = /** @type {const} */ ([
  [
    /\bctx\.(commands|settings|events|log|ui|panels|scene|setTimeout|setInterval)\b/,
    FIRST_APP_WITH_API,
  ],
]);

/**
 * @typedef {import("./manifest.mjs").Finding} Finding
 * @typedef {{ ok: boolean, errors: Finding[], warnings: Finding[] }} CheckResult
 */

/** Drops `/* ... *\/` blocks and whole-line `//` comments (strings are not parsed: best effort). */
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const STATIC_IMPORT =
  /(?<![.\w$])(?:import|export)\s*(?:type\s+)?(?:[^"';]*?\bfrom\s*)?["']([^"'\n]+)["']/g;
const DYNAMIC_IMPORT = /(?<![.\w$])import\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

/**
 * @param {string} code
 * @returns {string[]} import specifiers in the code
 */
export function scanImports(code) {
  const clean = stripComments(code);
  const out = [];
  for (const re of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    for (let m = re.exec(clean); m; m = re.exec(clean)) {
      out.push(m[1]);
    }
  }
  return out;
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * @param {string} dir
 * @returns {CheckResult}
 */
export function checkPlugin(dir) {
  const root = path.resolve(dir);
  let st;
  try {
    st = statSync(root);
  } catch {
    throw new EnvError(`Folder not found: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new EnvError(`Not a folder: ${dir}`);
  }
  /** @type {Finding[]} */
  const errors = [];
  /** @type {Finding[]} */
  const warnings = [];
  /** @param {Finding[]} list @param {string} code @param {string} file @param {string} message */
  const add = (list, code, file, message) => list.push({ code, message, file });

  const manifestPath = path.join(root, "plugin.toml");
  if (!isFile(manifestPath)) {
    add(
      errors,
      "plugin-toml-missing",
      "plugin.toml",
      "There is no plugin.toml in this folder",
    );
    return finish(errors, warnings);
  }
  const text = readFileSync(manifestPath, "utf8");
  const v = validateManifestText(text);
  errors.push(...v.errors);
  warnings.push(...v.warnings);

  let doc = null;
  try {
    doc = parseToml(text);
  } catch {
    // already reported as toml-parse
  }
  const main =
    doc && typeof doc.main === "string" && isSafeRelPath(doc.main)
      ? doc.main
      : null;
  if (main) {
    checkMain(
      root,
      main,
      typeof doc?.min_app === "string" ? doc.min_app : null,
      errors,
      warnings,
    );
  }

  const names = readdirSync(root);
  if (!names.some((n) => n.toLowerCase() === "readme.md")) {
    add(
      warnings,
      "readme-missing",
      "README.md",
      "There is no README.md; add one so people know what the plugin does",
    );
  }
  return finish(errors, warnings);
}

/** @param {Finding[]} errors @param {Finding[]} warnings @returns {CheckResult} */
const finish = (errors, warnings) => {
  /** @param {Finding} f @returns {Finding} */
  const shape = (f) => ({ code: f.code, message: f.message, file: f.file });
  return {
    ok: errors.length === 0,
    errors: errors.map(shape),
    warnings: warnings.map(shape),
  };
};

/**
 * @param {string} root
 * @param {string} main
 * @param {string | null} minApp
 * @param {Finding[]} errors
 * @param {Finding[]} warnings
 */
function checkMain(root, main, minApp, errors, warnings) {
  const mainPath = path.join(root, ...main.split("/"));
  if (!isFile(mainPath)) {
    const built =
      isFile(path.join(root, "src", "main.ts")) ||
      isFile(path.join(root, "src", "main.tsx")) ||
      isFile(path.join(root, "dist", "plugin.toml"));
    errors.push({
      code: "main-missing",
      file: main,
      message: built
        ? `${main} not found: run \`vaultdraw-plugin build\` first (or check dist/)`
        : `The main file '${main}' does not exist`,
    });
    return;
  }
  const size = statSync(mainPath).size;
  if (size > BUNDLE_WARN_BYTES) {
    warnings.push({
      code: "bundle-large",
      file: main,
      message: `${main} is ${Math.round(
        size / 1024,
      )} KB; over 100 KB slows loading, so bundle less or load parts lazily`,
    });
  }

  // Walk main and the relative modules it imports (JavaScript only).
  const queue = [mainPath];
  const seen = new Set(queue);
  const shared = new Set(SHARED_SPECIFIERS);
  const reported = new Set();
  let usesApi = false;
  while (queue.length > 0 && seen.size <= MAX_SCANNED_FILES) {
    const file = /** @type {string} */ (queue.shift());
    const rel = path.relative(root, file).split(path.sep).join("/");
    const code = readFileSync(file, "utf8");
    usesApi ||= API_AREAS.some(([re]) => re.test(stripComments(code)));
    for (const spec of scanImports(code)) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = path.resolve(path.dirname(file), spec);
        const inside = path.relative(root, target);
        if (
          !isFile(target) ||
          inside.startsWith("..") ||
          path.isAbsolute(inside)
        ) {
          const key = `${rel}|${spec}`;
          if (!reported.has(key)) {
            reported.add(key);
            warnings.push({
              code: "import-missing",
              file: rel,
              message: `${rel} imports '${spec}', which is not a file in the plugin folder`,
            });
          }
        } else if (/\.(m?js)$/.test(target) && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      } else if (!shared.has(spec)) {
        const key = `${rel}|${spec}`;
        if (!reported.has(key)) {
          reported.add(key);
          errors.push({
            code: "imports-unshared",
            file: rel,
            message: `${rel} imports '${spec}', which the app does not provide; bundle it into ${main} or use one of: ${SHARED_SPECIFIERS.join(
              ", ",
            )}`,
          });
        }
      }
    }
  }
  if (
    minApp &&
    usesApi &&
    isSemverSafe(minApp) &&
    compareSemver(minApp, FIRST_APP_WITH_API) < 0
  ) {
    warnings.push({
      code: "min-app-low",
      file: "plugin.toml",
      message: `min_app ${minApp} is lower than ${FIRST_APP_WITH_API}, the first app version with the plugin API the code uses (best effort)`,
    });
  }
}

const isSemverSafe = (v) => {
  try {
    compareSemver(v, "0.0.0");
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {CheckResult} r
 * @param {string} dir
 * @returns {string}
 */
export function formatText(r, dir) {
  const lines = [];
  for (const [label, list] of /** @type {const} */ ([
    ["error", r.errors],
    ["warning", r.warnings],
  ])) {
    for (const f of list) {
      lines.push(`${label}: ${f.message} [${f.code}] (${f.file})`);
    }
  }
  const n = (k, c) => `${c} ${k}${c === 1 ? "" : "s"}`;
  lines.push(
    r.ok && r.warnings.length === 0
      ? `Checked ${dir}: no problems found.`
      : `Checked ${dir}: ${n("error", r.errors.length)}, ${n(
          "warning",
          r.warnings.length,
        )}.`,
  );
  return lines.join("\n");
}

/**
 * Checks a `.zip` package: strict read into a temp folder, optional `.sha256` sidecar,
 * flat layout, then the normal checks. Findings refer to zip entries.
 * @param {string} file
 * @returns {Promise<CheckResult>}
 */
export async function checkZip(file) {
  const { readZip, ZipError } = await import("./zip.mjs");
  /** @type {Finding[]} */
  const errors = [];
  const bytes = readFileSync(file);
  const sidecar = `${file}.sha256`;
  if (existsSync(sidecar)) {
    const want = /^([0-9a-fA-F]{64})(?:\s|$)/.exec(
      readFileSync(sidecar, "utf8"),
    )?.[1];
    const got = createHash("sha256").update(bytes).digest("hex");
    if (!want || want.toLowerCase() !== got) {
      errors.push({
        code: "zip-checksum",
        file: path.basename(sidecar),
        message: want
          ? `The zip does not match ${path.basename(
              sidecar,
            )} (expected ${want.toLowerCase()}, got ${got})`
          : `${path.basename(sidecar)} does not hold a sha256 checksum`,
      });
    }
  }
  /** @type {{ name: string, data: Buffer }[]} */
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    if (e instanceof ZipError) {
      errors.push({
        code: "zip-invalid",
        file: path.basename(file),
        message: e.message,
      });
      return finish(errors, []);
    }
    throw e;
  }
  if (!entries.some((e) => e.name === "plugin.toml")) {
    const tops = new Set(entries.map((e) => e.name.split("/")[0]));
    if (
      tops.size === 1 &&
      entries.some((e) => /^[^/]+\/plugin\.toml$/.test(e.name))
    ) {
      errors.push({
        code: "zip-layout",
        file: `${[...tops][0]}/plugin.toml`,
        message:
          "plugin.toml is inside a top folder; put plugin.toml and the other files at the zip root",
      });
      return finish(errors, []);
    }
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "vdp-zip-"));
  try {
    for (const { name, data } of entries) {
      const target = path.join(tmp, ...name.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    const r = checkPlugin(tmp);
    return finish([...errors, ...r.errors], r.warnings);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {string} dir a plugin folder or a `.zip` file
 * @param {{ json?: boolean, activate?: boolean, timeoutMs?: number }} opts
 * @param {(s: string) => void} out
 * @returns {Promise<number>} the exit code
 */
export async function runCheck(dir, opts, out) {
  const isZip = /\.zip$/i.test(dir) && isFile(dir);
  if (opts.activate && isZip) {
    throw new EnvError(
      "--activate needs a plugin folder, not a zip: unzip it and check the folder",
    );
  }
  const r = isZip ? await checkZip(dir) : checkPlugin(dir);
  /** @type {import("./activate.mjs").ActivationResult | null} */
  let activation = null;
  if (opts.activate && r.ok) {
    if (!opts.json) {
      out(
        "Note: --activate runs the plugin's code on this computer; use it only on plugins you trust.",
      );
    }
    const { activatePlugin } = await import("./activate.mjs");
    activation = await activatePlugin(dir, { timeoutMs: opts.timeoutMs });
    r.errors.push(...activation.errors);
    r.warnings.push(...activation.warnings);
    r.ok = r.errors.length === 0;
  }
  if (opts.json) {
    out(
      JSON.stringify(
        {
          schemaVersion: 1,
          ok: r.ok,
          errors: r.errors,
          warnings: r.warnings,
          ...(opts.activate
            ? {
                activation: activation
                  ? {
                      commands: activation.commands,
                      panels: activation.panels,
                      ms: activation.ms,
                    }
                  : null,
              }
            : {}),
        },
        null,
        2,
      ),
    );
  } else {
    out(formatText(r, dir));
    if (opts.activate && activation) {
      for (const l of activation.log) {
        out(`log | ${l.level}: ${l.text}`);
      }
    }
    if (opts.activate) {
      out(
        activation
          ? `Activation: ran in ${activation.ms} ms; bound ${
              activation.commands.length
            } command${activation.commands.length === 1 ? "" : "s"} and ${
              activation.panels.length
            } panel${activation.panels.length === 1 ? "" : "s"}.`
          : "Activation: skipped because the static checks found errors.",
      );
    }
  }
  return r.ok ? 0 : 1;
}
