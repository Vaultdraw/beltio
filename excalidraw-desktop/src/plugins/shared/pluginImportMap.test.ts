import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  importMapCspHash,
  injectImportMap,
  shimSource,
} from "../../../vite-plugins/pluginImportMap";

import { importMapText } from "./importMap";
import { SHARED_MODULES, shimUrl } from "./specifiers";

const req = createRequire(import.meta.url);

describe("import map text", () => {
  it("is deterministic, compact and maps every shared specifier to a root-relative shim", () => {
    expect(importMapText()).toBe(importMapText());
    expect(importMapText()).not.toMatch(/\s|\r/);
    const { imports } = JSON.parse(importMapText());
    expect(Object.keys(imports)).toEqual(
      SHARED_MODULES.map((m) => m.specifier),
    );
    expect(imports["react/jsx-runtime"]).toBe(
      "/plugin-shims/react-jsx-runtime.js",
    );
    for (const url of Object.values<string>(imports)) {
      // Resolves against the document base, not the importing module's origin.
      expect(new URL(url, "tauri://localhost/").href).toMatch(
        /^tauri:\/\/localhost\/plugin-shims\/.+\.js$/,
      );
    }
    expect(shimUrl("@vaultdraw/api")).toBe("/plugin-shims/vaultdraw-api.js");
  });

  it("hash is the sha256 of the text", () => {
    expect(importMapCspHash()).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
  });
});

describe("injectImportMap", () => {
  it("places the map before modulepreload and module scripts", () => {
    const html =
      '<html><head lang="en"><meta charset="utf-8"><link rel="modulepreload" href="/a.js"><script type="module" src="/m.js"></script></head><body></body></html>';
    const out = injectImportMap(html);
    const map = out.indexOf('<script type="importmap">');
    expect(map).toBeGreaterThan(-1);
    expect(map).toBeLessThan(out.indexOf("modulepreload"));
    expect(map).toBeLessThan(out.indexOf('type="module"'));
    expect(out).toContain(
      `<script type="importmap">${importMapText()}</script>`,
    );
  });

  it("rejects HTML without a head", () => {
    expect(() => injectImportMap("<p>x</p>")).toThrow();
  });
});

describe("shim sources", () => {
  const exportedNames = (src: string) =>
    [...src.matchAll(/export const \{ ([^}]+) \} = m;/g)].flatMap((m) =>
      m[1].split(", "),
    );

  it.each(["react", "react/jsx-runtime", "react-dom", "react-dom/client"])(
    "%s shim covers every runtime key of the real package",
    (spec) => {
      const keys = Object.keys(req(spec)).filter((k) =>
        /^[A-Za-z_$][\w$]*$/.test(k),
      );
      const src = shimSource(spec, Object.keys(req(spec)), true, true);
      expect(src).toContain(`globalThis.__vaultdraw["${spec}"]`);
      expect(src).toContain("export default m;");
      expect(exportedNames(src).sort()).toEqual(keys.sort());
    },
  );

  it("has the keys plugins rely on", () => {
    const react = exportedNames(
      shimSource("react", Object.keys(req("react")), true, true),
    );
    expect(react).toEqual(
      expect.arrayContaining(["useState", "createElement", "Fragment"]),
    );
    const jsx = exportedNames(
      shimSource(
        "react/jsx-runtime",
        Object.keys(req("react/jsx-runtime")),
        true,
        true,
      ),
    );
    expect(jsx).toEqual(expect.arrayContaining(["jsx", "jsxs", "Fragment"]));
  });

  it.each(SHARED_MODULES.filter((m) => m.lazy).map((m) => m.specifier))(
    "%s lazy shim awaits load and covers every runtime key",
    (spec) => {
      const keys = Object.keys(req(spec)).filter((k) =>
        /^[A-Za-z_$][\w$]*$/.test(k),
      );
      const src = shimSource(spec, Object.keys(req(spec)), false, false, true);
      expect(src).toContain(`await globalThis.__vaultdraw.load("${spec}")`);
      expect(src).not.toContain("export default");
      expect(exportedNames(src).sort()).toEqual(keys.sort());
    },
  );

  it("api shim re-exports named exports and a real default only", () => {
    const src = shimSource(
      "@vaultdraw/api",
      ["definePlugin", "default", "not-valid"],
      true,
      false,
    );
    expect(src).toContain("export default m.default;");
    expect(src).toContain("export const { definePlugin } = m;");
    expect(
      shimSource("@vaultdraw/api", ["definePlugin"], false, false),
    ).not.toContain("export default");
  });
});
