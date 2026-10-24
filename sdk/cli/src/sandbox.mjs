/**
 * `vaultdraw-plugin dev --sandbox`: a throwaway Vaultdraw instance for one plugin.
 *
 * Makes `<tmp>/vds-xxxxxx/` with `config/` (config.toml enabling the plugin), `state/` and a
 * `vault/` with one drawing, starts the app on them and removes the folder on exit.
 *
 * Isolation: `VAULTDRAW_CONFIG_DIR`, `VAULTDRAW_STATE_DIR` and `VAULTDRAW_VAULT` point at the
 * sandbox. The app (built with the P3c change) opens only `VAULTDRAW_VAULT`, never reads or
 * writes the user's `recent-vault` while it is set, so the real vault cannot be opened.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { EnvError } from "./dirs.mjs";
import { FIRST_APP_WITH_API } from "./check.mjs";
import { compareSemver } from "./semver.mjs";

/** Written into every sandbox; `removeSandbox` deletes only folders that carry it. */
export const MARKER = ".vaultdraw-sandbox";
const PREFIX = "vds-";

/** @param {{ platform?: string }} [o] */
const tmpRoot = (o = {}) =>
  (o.platform ?? process.platform) === "win32" ? os.tmpdir() : "/tmp";

/**
 * The app binary: `--app`, then `$VAULTDRAW_APP`, then the platform default.
 * @param {{ app?: string, env: Record<string, string | undefined>, platform?: string }} o
 * @returns {string}
 */
export function findApp({ app, env, platform = process.platform }) {
  const candidate =
    app ??
    (env.VAULTDRAW_APP || undefined) ??
    (platform === "darwin"
      ? "/Applications/Vaultdraw.app/Contents/MacOS/excalidraw-vault"
      : undefined);
  if (!candidate) {
    throw new EnvError(
      "Cannot find the Vaultdraw app. Pass --app <path to the app binary> or set VAULTDRAW_APP.",
    );
  }
  const file = path.resolve(candidate);
  if (!existsSync(file)) {
    throw new EnvError(
      `The Vaultdraw app was not found at ${file}. Pass --app <path> or set VAULTDRAW_APP.`,
    );
  }
  return file;
}

/**
 * The app version, read from the macOS bundle (`<App>.app/Contents/Info.plist`).
 * @param {string} bin
 * @returns {string | null} null when it cannot be read
 */
export function readAppVersion(bin) {
  const plist = path.join(path.dirname(bin), "..", "Info.plist");
  try {
    const m =
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
        readFileSync(plist, "utf8"),
      );
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string | null} appVersion
 * @param {string | null | undefined} minApp
 * @returns {{ error?: string, warning?: string }}
 */
export function checkAppVersion(appVersion, minApp) {
  if (!appVersion) {
    return {
      warning:
        "Could not read the app version, so min_app was not compared with it.",
    };
  }
  try {
    if (compareSemver(appVersion, FIRST_APP_WITH_API) < 0) {
      return {
        error: `This app is version ${appVersion}, which has no plugin support (it starts with ${FIRST_APP_WITH_API}). Build or install a newer app and pass it with --app.`,
      };
    }
    if (minApp && compareSemver(appVersion, minApp) < 0) {
      return {
        error: `The plugin needs app ${minApp} or newer (min_app in plugin.toml), and this app is ${appVersion}.`,
      };
    }
  } catch {
    return { warning: `Could not compare app version ${appVersion}.` };
  }
  return {};
}

const DRAWING = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "vaultdraw-plugin dev --sandbox",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

/**
 * Creates the sandbox folders. Nothing outside `<tmp>/vds-xxxxxx/` is touched.
 * @param {string} pluginId
 * @param {{ platform?: string }} [o]
 * @returns {{ base: string, config: string, state: string, vault: string, env: Record<string, string> }}
 */
export function createSandbox(pluginId, o = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpRoot(o), PREFIX)));
  const config = path.join(base, "config");
  const state = path.join(base, "state");
  const vault = path.join(base, "vault");
  for (const d of [config, state, vault]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(path.join(base, MARKER), "created by vaultdraw-plugin dev --sandbox\n");
  writeFileSync(
    path.join(config, "config.toml"),
    `# Sandbox config made by vaultdraw-plugin dev --sandbox. Deleted on exit.\n[plugins]\nenabled = ["${pluginId}"]\n`,
  );
  writeFileSync(path.join(vault, "Sandbox drawing.excalidraw"), DRAWING);
  return {
    base,
    config,
    state,
    vault,
    env: {
      VAULTDRAW_CONFIG_DIR: config,
      VAULTDRAW_STATE_DIR: state,
      VAULTDRAW_VAULT: vault,
    },
  };
}

/**
 * Removes a sandbox folder, and only that: it must be a direct child of the temp root, named
 * `vds-*`, and carry the marker file.
 * @param {string} base
 * @param {{ platform?: string }} [o]
 * @returns {boolean} whether it was removed
 */
export function removeSandbox(base, o = {}) {
  let real;
  try {
    real = realpathSync(base);
  } catch {
    return false;
  }
  const root = realpathSync(tmpRoot(o));
  if (
    path.dirname(real) !== root ||
    !path.basename(real).startsWith(PREFIX) ||
    !existsSync(path.join(real, MARKER))
  ) {
    return false;
  }
  rmSync(real, { recursive: true, force: true });
  return true;
}

/**
 * Starts the app on the sandbox. Its stderr lines go to `log`.
 * @param {string} bin
 * @param {Record<string, string>} sandboxEnv
 * @param {(line: string) => void} log
 * @returns {{ child: import("node:child_process").ChildProcess, exited: Promise<{ code: number | null, signal: string | null, error?: Error }>, stop: () => Promise<void> }}
 */
export function launchApp(bin, sandboxEnv, log) {
  const child = spawn(bin, [], {
    env: { ...process.env, ...sandboxEnv },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let buf = "";
  child.stderr?.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (l.trim()) {
        log(l);
      }
    }
  });
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    // "close" comes after stderr ended, so the app's last lines are shown first.
    child.once("close", (code, signal) => {
      if (buf.trim()) {
        log(buf);
      }
      resolve({ code, signal });
    });
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  };
  return { child, exited, stop };
}
