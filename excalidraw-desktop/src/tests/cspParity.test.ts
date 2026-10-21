/**
 * The packaged WebView enforces BOTH Content-Security-Policies: the one Tauri
 * injects from tauri.conf.json and the <meta> tag in index.html. A source
 * missing from either one is blocked, so the meta tag must allow every image
 * and connect source the native policy allows (e.g. `vdthumb:` thumbnails).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { importMapCspHash } from "../../vite-plugins/pluginImportMap";

const root = resolve(__dirname, "../..");

const parse = (policy: string) =>
  new Map(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );

const nativePolicy = () =>
  parse(
    JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"))
      .app.security.csp,
  );

const metaPolicy = () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  if (!match) {
    throw new Error("index.html has no CSP meta tag");
  }
  return parse(match[1]);
};

describe("CSP parity between tauri.conf.json and index.html", () => {
  it.each(["img-src", "connect-src"])(
    "the meta %s allows every source the native policy allows",
    (directive) => {
      const native = nativePolicy().get(directive) ?? [];
      const meta = new Set(metaPolicy().get(directive) ?? []);
      expect(native.length).toBeGreaterThan(0);
      expect(native.filter((source) => !meta.has(source))).toEqual([]);
    },
  );

  it("both policies allow vdthumb: drawing thumbnails", () => {
    expect(nativePolicy().get("img-src")).toContain("vdthumb:");
    expect(metaPolicy().get("img-src")).toContain("vdthumb:");
  });
});

describe("native CSP style-src in release builds", () => {
  it("keeps 'unsafe-inline' effective: Tauri must not add a style nonce", () => {
    // index.html carries an inline <style>; with Tauri's nonce injection the
    // browser ignores 'unsafe-inline' and blocks CodeMirror/runtime styles.
    const security = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    ).app.security;
    expect(nativePolicy().get("style-src")).toContain("'unsafe-inline'");
    expect(security.dangerousDisableAssetCspModification).toContain(
      "style-src",
    );
    expect(security.dangerousDisableAssetCspModification).not.toContain(
      "script-src",
    );
  });
});

describe("plugin import map and vdplugin: scheme in both CSPs", () => {
  const sources = ["vdplugin:", "http://vdplugin.localhost"];

  it.each(["script-src", "style-src"])("%s allows the plugin scheme", (d) => {
    for (const policy of [nativePolicy(), metaPolicy()]) {
      expect(policy.get(d)).toEqual(expect.arrayContaining(sources));
    }
  });

  it("script-src carries the sha256 of the exact import map text", () => {
    for (const policy of [nativePolicy(), metaPolicy()]) {
      expect(policy.get("script-src")).toContain(importMapCspHash());
    }
  });
});
