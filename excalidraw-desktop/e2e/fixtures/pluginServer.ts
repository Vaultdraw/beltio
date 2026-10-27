/** Serves the e2e plugin fixtures from the preview server at /e2e-plugins/<id>/main.js. */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// @ts-expect-error the CLI is plain .mjs
import { parseToml } from "../../../sdk/cli/src/toml.mjs";
import {
  readExample,
  readPluginDir,
} from "../../../sdk/examples/testing/readManifest";
import { makePluginInfo } from "../../src/plugins/host/fakeBackend";

import type { Plugin } from "vite";

/** Realistic-looking plugin of about `bytes` bytes: a lookup table plus many small functions. */
export const sizedPluginSource = (id: string, bytes: number): string => {
  const head = `const table = {\n${Array.from(
    { length: 40 },
    (_, i) =>
      `  key${i}: { id: ${i}, label: "item ${i}", weight: ${(i * 7) % 13} },`,
  ).join("\n")}\n};\n`;
  const tail = `export default {
  activate(ctx) {
    ctx.commands.register("run", () => {
      ctx.ui.toast("${id} ran " + f0(1, 2));
    });
  },
};
`;
  const parts: string[] = [head];
  let size = head.length + tail.length;
  for (let i = 0; size < bytes; i++) {
    const fn = `function f${i}(a, b) {
  const x = (a * 31 + b * ${i + 3}) % 9973;
  if (x % 2 === 0) {
    return table.key${i % 40}.weight + x;
  }
  return [x, a, b].map((v) => v + ${i}).reduce((s, v) => s + v, 0);
}
`;
    parts.push(fn);
    size += fn.length;
  }
  return parts.join("") + tail;
};

const SIZED = /^size(\d+)([km])$/;

/**
 * Where the CLI e2e test lets `vaultdraw-plugin dev` write: the plugins folder of a
 * throwaway config directory. A plugin found there wins over fixtures and examples.
 */
const cliPluginsDir = () =>
  path.resolve(__dirname, "../../../.cache/e2e-cli/config/plugins");

/** `plugins/official/<id>/dist`, built by plugins/official/build.mjs; the playwright web server builds it first. */
const officialDir = (id: string) =>
  path.resolve(__dirname, "../../../plugins/official", id, "dist");

/** An official plugin's manifest as the backend would list it (the full TOML reader: settings with options, permissions). */
const readOfficial = async (id: string) => {
  const dir = officialDir(id);
  const doc = parseToml(await readFile(path.join(dir, "plugin.toml"), "utf8"));
  const c = doc.contributes ?? {};
  const { size } = await stat(path.join(dir, doc.main ?? "main.js"));
  return makePluginInfo(doc.id, {
    name: doc.name,
    version: doc.version,
    api: doc.api,
    minApp: doc.min_app ?? null,
    main: doc.main ?? "main.js",
    description: doc.description ?? null,
    author: doc.author ?? null,
    source: "bundled",
    dir,
    mainBytes: size,
    activation: doc.activation ?? [],
    permissions: doc.permissions ?? [],
    dataKey: doc.data_key ?? null,
    contributes: {
      commands: (c.commands ?? []).map((x: any) => ({
        id: x.id,
        title: x.title,
        keys: x.keys ?? [],
        when: x.when ?? [],
        palette: x.palette ?? true,
        repeat: x.repeat ?? false,
      })),
      panels: [],
      menus: (c.menus ?? []).map((x: any) => ({
        surface: x.surface,
        command: x.command,
        title: x.title ?? null,
        kinds: x.kinds ?? [],
      })),
      settings: c.settings ?? [],
      importers: (c.importers ?? []).map((x: any) => ({
        id: x.id,
        title: x.title ?? x.id,
        extensions: x.extensions,
      })),
    },
  });
};

export const e2ePluginFixtures = (): Plugin => {
  const root = path.resolve(__dirname, "plugins");
  const examples = path.resolve(__dirname, "../../../sdk/examples");
  /** An e2e fixture wins; otherwise the sdk/examples plugin of that id. */
  const cliDir = (id: string) => path.join(cliPluginsDir(), id);
  const mainPath = (id: string) =>
    existsSync(path.join(cliDir(id), "plugin.toml"))
      ? path.join(cliDir(id), "main.js")
      : existsSync(path.join(root, id, "main.js"))
      ? path.join(root, id, "main.js")
      : existsSync(path.join(officialDir(id), "main.js"))
      ? path.join(officialDir(id), "main.js")
      : path.join(examples, id, "main.js");
  return {
    name: "e2e-plugin-fixtures",
    configurePreviewServer(server) {
      // /e2e-plugins/<id>/plugin.json: manifest of an sdk/examples plugin.
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/e2e-plugins\/([a-z0-9-]+)\/plugin\.json(\?.*)?$/.exec(
          req.url ?? "",
        );
        if (!m) {
          return next();
        }
        try {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            JSON.stringify(
              existsSync(path.join(cliDir(m[1]), "plugin.toml"))
                ? readPluginDir(cliDir(m[1]))
                : existsSync(path.join(officialDir(m[1]), "plugin.toml"))
                ? await readOfficial(m[1])
                : readExample(m[1]),
            ),
          );
        } catch {
          res.statusCode = 404;
          res.end("not found");
        }
      });
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/e2e-plugins\/([a-z0-9-]+)\/main\.js(\?.*)?$/.exec(
          req.url ?? "",
        );
        if (!m) {
          return next();
        }
        const id = m[1];
        const sized = SIZED.exec(id);
        try {
          const source = sized
            ? sizedPluginSource(
                id,
                Number(sized[1]) * (sized[2] === "m" ? 1024 * 1024 : 1024),
              )
            : await readFile(mainPath(id), "utf8");
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(source);
        } catch {
          res.statusCode = 404;
          res.end("not found");
        }
      });
    },
  };
};
