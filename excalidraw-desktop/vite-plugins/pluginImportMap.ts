import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  importMapScriptTag,
  importMapText,
} from "../src/plugins/shared/importMap";
import {
  SHARED_MODULES,
  SHIM_DIR,
  shimFileName,
} from "../src/plugins/shared/specifiers";

import type { Plugin } from "vite";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const API_ENTRY = "src/plugins/api/index.ts";

/** CSP source expression for the inline import map. */
export const importMapCspHash = (): string =>
  `'sha256-${createHash("sha256").update(importMapText()).digest("base64")}'`;

/** Puts the import map first in <head>: a map after any module fetch is ignored. */
export const injectImportMap = (html: string): string => {
  if (!/<head[\s>]/i.test(html)) {
    throw new Error("plugin-import-map: HTML has no <head>");
  }
  return html.replace(
    /<head(\s[^>]*)?>/i,
    (open) => open + importMapScriptTag(),
  );
};

/** Source of one shim: named exports read from the host instance. */
export const shimSource = (
  globalKey: string,
  names: readonly string[],
  hasDefault: boolean,
  defaultIsNamespace: boolean,
  lazy = false,
): string => {
  const named = names.filter((n) => n !== "default" && IDENTIFIER.test(n));
  const key = JSON.stringify(globalKey);
  const lines = [
    lazy
      ? `const m = await globalThis.__vaultdraw.load(${key});`
      : `const m = globalThis.__vaultdraw[${key}];`,
  ];
  if (hasDefault) {
    lines.push(`export default ${defaultIsNamespace ? "m" : "m.default"};`);
  }
  if (named.length) {
    lines.push(`export const { ${named.join(", ")} } = m;`);
  }
  return `${lines.join("\n")}\n`;
};

/** Runtime export names of an npm package (CommonJS keys, read at build time). */
const packageExports = (root: string, specifier: string): string[] =>
  Object.keys(createRequire(path.join(root, "x.js"))(specifier)).sort();

/** Export names of the app's own TS API module, read from esbuild's metafile (nothing executes). */
const apiExports = async (root: string): Promise<string[]> => {
  const entry = path.join(root, API_ENTRY);
  if (!existsSync(entry)) {
    return [];
  }
  // Lazy: only the build/dev server needs esbuild, not importers of the hash helpers.
  const { build: esbuild } = await import("esbuild");
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    packages: "external",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const output = Object.values(result.metafile.outputs)[0];
  return [...output.exports].sort();
};

const buildShims = async (root: string): Promise<Map<string, string>> => {
  const shims = new Map<string, string>();
  for (const { specifier, globalKey, lazy } of SHARED_MODULES) {
    const isApp = specifier === "@vaultdraw/api";
    const names = isApp
      ? await apiExports(root)
      : packageExports(root, specifier);
    shims.set(
      `${SHIM_DIR}/${shimFileName(specifier)}`,
      shimSource(
        globalKey,
        names,
        isApp ? names.includes("default") : !lazy,
        !isApp && !lazy,
        lazy,
      ),
    );
  }
  return shims;
};

/**
 * Plugin import map (ADR-0001): injects the static inline import map and
 * serves/emits the shim modules it points at. Dev and preview serve the same
 * strings the build emits, with stable (unhashed) file names.
 */
export const pluginImportMap = (): Plugin => {
  let root = process.cwd();
  let shims: Promise<Map<string, string>> | undefined;
  const getShims = () => (shims ??= buildShims(root));

  const middleware = async (
    req: { url?: string },
    res: {
      setHeader(k: string, v: string): void;
      end(body: string): void;
    },
    next: () => void,
  ) => {
    const key = (req.url ?? "").split("?")[0].replace(/^\//, "");
    const source = (await getShims()).get(key);
    if (source === undefined) {
      return next();
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end(source);
  };

  return {
    name: "vault-plugin-import-map",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    transformIndexHtml: {
      order: "post",
      handler: injectImportMap,
    },
    async generateBundle() {
      for (const [fileName, source] of await getShims()) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
};
