// The Windows bundle config: NSIS, per-user, embedded WebView2 bootstrapper, PATH hook; macOS config untouched.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const tauri = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const read = (f) => JSON.parse(readFileSync(join(tauri, f), "utf8"));

test("windows config builds a per-user NSIS installer with the embedded bootstrapper", () => {
  const { bundle } = read("tauri.windows.conf.json");
  assert.deepEqual(bundle.targets, ["nsis"]);
  assert.equal(bundle.windows.webviewInstallMode.type, "embedBootstrapper");
  assert.equal(bundle.windows.nsis.installMode, "currentUser");
  assert.ok(bundle.icon.includes("icons/icon.ico") && existsSync(join(tauri, "icons/icon.ico")));
  assert.ok(existsSync(join(tauri, bundle.windows.nsis.installerHooks)));
});

test("PATH hook adds on install and removes on uninstall, user scope only", () => {
  const hooks = readFileSync(join(tauri, "windows/hooks.nsh"), "utf8");
  assert.match(hooks, /NSIS_HOOK_POSTINSTALL/);
  assert.match(hooks, /NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks, /HKCU "Environment" "Path"/);
  assert.doesNotMatch(hooks, /HKLM/);
});

test("the macOS config is unchanged by the Windows work", () => {
  const { bundle } = read("tauri.conf.json");
  assert.deepEqual(bundle.targets, ["app", "dmg"]);
  assert.equal(bundle.windows, undefined);
});
