/**
 * `vaultdraw-plugin check --activate`: runs the plugin's `activate` once in a child process
 * against a dry context (see `activateChild.mjs`), with a timeout. The plugin's code runs with
 * your rights, like in the app, so use it only on plugins you trust.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EnvError } from "./dirs.mjs";
import { SHARED_SPECIFIERS } from "./shared.mjs";
import { parseToml } from "./toml.mjs";

export const DEFAULT_TIMEOUT_MS = 5000;
const MARK = "@@vaultdraw-activate@@";
/** `module.registerHooks` arrived in Node 22.15. */
const MIN_NODE = "22.15";

/**
 * @typedef {{ code: string, message: string, file: string }} Finding
 * @typedef {{ errors: Finding[], warnings: Finding[], commands: string[], panels: string[], ms: number, log: { level: string, text: string }[] }} ActivationResult
 */

/** @param {string} v */
const nodeAtLeast = (v) => {
  const [a, b] = process.versions.node.split(".").map(Number);
  const [x, y] = v.split(".").map(Number);
  return a > x || (a === x && b >= y);
};

/**
 * @param {string} dir a plugin folder that passed the static checks
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ActivationResult>}
 */
export async function activatePlugin(dir, opts = {}) {
  if (!nodeAtLeast(MIN_NODE)) {
    throw new EnvError(
      `--activate needs Node ${MIN_NODE} or newer (this is ${process.versions.node})`,
    );
  }
  const root = path.resolve(dir);
  const manifest = parseToml(readFileSync(path.join(root, "plugin.toml"), "utf8"));
  const main = String(manifest.main);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const job = { root, main, shared: SHARED_SPECIFIERS, manifest };

  const child = spawn(
    process.execPath,
    [path.join(import.meta.dirname, "activateChild.mjs"), JSON.stringify(job)],
    {
      cwd: root,
      // Only what Node needs; the plugin does not get your tokens by accident.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    if (stdout.length < 1_000_000) {
      stdout += d;
    }
  });
  child.stderr.on("data", (d) => {
    if (stderr.length < 20_000) {
      stderr += d;
    }
  });
  /** @type {"timeout" | null} */
  let killed = null;
  const timer = setTimeout(() => {
    killed = "timeout";
    child.kill("SIGKILL");
  }, timeoutMs);
  const code = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c));
    child.on("error", () => resolve(-1));
  });
  clearTimeout(timer);

  /** @type {ActivationResult} */
  const result = { errors: [], warnings: [], commands: [], panels: [], ms: 0, log: [] };
  if (killed) {
    result.errors.push({
      code: "activate-timeout",
      file: main,
      message: `activate() did not finish within ${timeoutMs} ms (an endless loop, or an await that never resolves). Keep activate() quick: bind handlers and return`,
    });
    return result;
  }
  const at = stdout.lastIndexOf(MARK);
  if (at < 0) {
    const tail = stderr.trim().split("\n").slice(-3).join(" | ");
    result.errors.push({
      code: "activate-crashed",
      file: main,
      message: `The plugin ended the dry run without a result (exit code ${code})${tail ? `: ${tail}` : ""}`,
    });
    return result;
  }
  const r = JSON.parse(stdout.slice(at + MARK.length).split("\n")[0]);
  for (const f of r.findings) {
    (f.level === "error" ? result.errors : result.warnings).push({
      code: f.code,
      file: f.code.startsWith("activate-unbound") ? "plugin.toml" : main,
      message: f.message,
    });
  }
  result.commands = r.commands;
  result.panels = r.panels;
  result.ms = r.ms;
  result.log = r.logs;
  return result;
}
