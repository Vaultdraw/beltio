/** Serves the e2e plugin fixtures from the preview server at /e2e-plugins/<id>/main.js. */
import { readFile } from "node:fs/promises";
import path from "node:path";

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

export const e2ePluginFixtures = (): Plugin => {
  const root = path.resolve(__dirname, "plugins");
  return {
    name: "e2e-plugin-fixtures",
    configurePreviewServer(server) {
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
            : await readFile(path.join(root, id, "main.js"), "utf8");
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
