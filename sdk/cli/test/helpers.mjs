import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname;
export const BIN = path.join(HERE, "..", "bin", "vaultdraw-plugin.mjs");
export const SDK = path.resolve(HERE, "..", "..");
export const REPO = path.resolve(SDK, "..");

const made = [];

/** A fresh folder under os.tmpdir(), removed by `cleanup()`. */
export function tmp(prefix = "vdp-test-") {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

export function cleanup() {
  for (const d of made.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
}

/** Writes `files` ({ "a/b.txt": "text" }) below `dir`. */
export function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) {
      continue;
    }
    const f = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return dir;
}

export const MANIFEST = `id = "demo-plugin"
name = "Demo"
version = "1.0.0"
api = 0
main = "main.js"
`;

/** A small valid plugin folder. */
export function makePlugin(extra = {}) {
  const dir = tmp("vdp-plugin-");
  write(dir, {
    "plugin.toml": MANIFEST,
    "main.js":
      'import { definePlugin } from "@vaultdraw/api";\nexport default definePlugin({ activate() {} });\n',
    "README.md": "# Demo\n",
    ...extra,
  });
  return dir;
}

/** Runs the command line in a child process. */
export function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    timeout: 30000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Starts the command line and collects its output; `stop()` ends it and resolves the exit code. */
export function start(args, opts = {}) {
  const child = spawn(process.execPath, [BIN, ...args], {
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise((res) =>
    child.on("exit", (code, signal) => res({ code, signal })),
  );
  return {
    child,
    output: () => out,
    errors: () => err,
    exited,
    stop() {
      child.kill("SIGINT");
      return Promise.race([
        exited,
        new Promise((res) =>
          setTimeout(() => {
            child.kill("SIGKILL");
            res({ code: null, signal: "SIGKILL" });
          }, 5000),
        ),
      ]);
    },
  };
}

/** Polls `fn` until it returns a truthy value or `ms` pass. */
export async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) {
      return v;
    }
    if (Date.now() > end) {
      throw new Error("timed out waiting for a condition");
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
