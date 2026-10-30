// The Linux override (src-tauri/tauri.linux.conf.json) is merged over tauri.conf.json by the Tauri CLI
// as a JSON Merge Patch (RFC 7396): objects merge key by key, arrays are replaced whole, null deletes.
// This test does the same merge and checks the result against Tauri's own config schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const base = readJson(join(desktop, "src-tauri/tauri.conf.json"));
const linux = readJson(join(desktop, "src-tauri/tauri.linux.conf.json"));

function mergePatch(target, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

const merged = mergePatch(base, linux);
const MAC_ONLY_WINDOW_KEYS = ["titleBarStyle", "hiddenTitle", "trafficLightPosition", "tabbingIdentifier"];

test("the merged window has no macOS-only keys but keeps the base behaviour", () => {
  assert.equal(merged.app.windows.length, 1);
  const [win] = merged.app.windows;
  for (const k of MAC_ONLY_WINDOW_KEYS) assert.ok(!(k in win), `window.${k} must not be set on Linux`);
  const [baseWin] = base.app.windows;
  for (const k of Object.keys(baseWin).filter((k) => !MAC_ONLY_WINDOW_KEYS.includes(k))) {
    assert.deepEqual(win[k], baseWin[k], `window.${k} differs from the base`);
  }
});

test("Linux bundles deb, rpm and AppImage and keeps the sidecar, resources and security settings", () => {
  assert.deepEqual(merged.bundle.targets, ["deb", "rpm", "appimage"]);
  assert.deepEqual(merged.bundle.externalBin, base.bundle.externalBin);
  assert.deepEqual(merged.bundle.resources, base.bundle.resources);
  assert.equal(merged.app.security.csp, base.app.security.csp);
  assert.equal(merged.identifier, "app.vaultdraw");
});

// ajv is only a transitive dependency (via eslint), so skip rather than fail if an install layout drops it.
let Ajv = null;
try {
  Ajv = require("ajv");
} catch {}

test("the base and the merged config are valid against the Tauri config schema", { skip: !Ajv && "ajv is not installed" }, () => {
  const schema = readJson(require.resolve("@tauri-apps/cli/config.schema.json"));
  const validate = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false, validateFormats: false }).compile(schema);
  assert.ok(validate(base), JSON.stringify(validate.errors, null, 2));
  assert.ok(validate(merged), JSON.stringify(validate.errors, null, 2));
});

test("the override only touches what Linux needs", () => {
  assert.deepEqual(Object.keys(linux).filter((k) => k !== "$schema").sort(), ["app", "bundle"]);
  assert.deepEqual(Object.keys(linux.app), ["windows"]);
});
