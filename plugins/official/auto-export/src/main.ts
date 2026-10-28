/**
 * auto-export: SVG and PNG copies of drawings, written after a save. Official, bundled. It loads
 * at startup only when `[plugin.auto-export] enabled = true` (or the host runs for another
 * reason), and while `enabled` is false it listens to nothing.
 */
import { definePlugin } from "@vaultdraw/api";

import { readConfig } from "./config";
import { createExporter } from "./exporter";
import { allExportPaths, isDrawing, isExcluded } from "./paths";

import type { Disposable, PluginContext } from "@vaultdraw/api";

const tick = (ctx: PluginContext) =>
  new Promise<void>((resolve) => ctx.setTimeout(resolve, 0));

export default definePlugin({
  activate(ctx) {
    const config = () => readConfig(ctx);
    const exporter = createExporter(ctx, config);
    let listening: Disposable[] = [];
    let stopped = false;

    const failed = (what: string, e: unknown) =>
      ctx.log.warn(`${what} failed`, e);

    async function renamed({ from, to }: { from: string; to: string }) {
      const cfg = config();
      try {
        if (isDrawing(from) && isDrawing(to)) {
          if (!cfg.moveOnRename) {
            if (!isExcluded(to, cfg)) {
              exporter.schedule(to);
            }
            return;
          }
          const before = allExportPaths(from, cfg.folder);
          const after = allExportPaths(to, cfg.folder);
          let moved = false;
          for (let i = 0; i < before.length; i++) {
            moved =
              (await ctx.vault.exports.move(before[i], after[i])) || moved;
          }
          if (!moved && !isExcluded(to, cfg)) {
            exporter.schedule(to); // it had no export yet
          }
        } else if (cfg.moveOnRename && cfg.folder !== "" && !isDrawing(from)) {
          await ctx.vault.exports.move(
            `${cfg.folder}/${from}`,
            `${cfg.folder}/${to}`,
          );
        }
      } catch (e) {
        failed("Moving the exported file", e);
      }
    }

    async function deleted({ path }: { path: string }) {
      const cfg = config();
      if (!cfg.removeOnDelete) {
        return;
      }
      try {
        if (isDrawing(path)) {
          for (const p of allExportPaths(path, cfg.folder)) {
            await ctx.vault.exports.remove(p);
          }
        } else if (cfg.folder !== "") {
          await ctx.vault.exports.remove(`${cfg.folder}/${path}`);
        }
      } catch (e) {
        failed("Removing the exported file", e);
      }
    }

    const attach = () => {
      if (listening.length > 0) {
        return;
      }
      listening = [
        ctx.events.on("drawing.saved", ({ path }) => {
          if (isDrawing(path)) {
            exporter.schedule(path);
          }
        }),
        ctx.events.on("drawing.renamed", (e) => void renamed(e)),
        ctx.events.on("drawing.deleted", (e) => void deleted(e)),
      ];
    };
    const detach = () => {
      listening.forEach((d) => d.dispose());
      listening = [];
      exporter.clear();
    };

    if (config().enabled) {
      attach();
    }
    ctx.subscriptions.push(
      ctx.settings.onChange("enabled", (on) => (on ? attach() : detach())),
      { dispose: () => (stopped = true) },
      { dispose: detach },
    );

    ctx.commands.register("export-current", async () => {
      const path = ctx.scene.path();
      if (path === null) {
        ctx.ui.toast("Open a drawing first");
        return;
      }
      const wrote = await exporter.exportNow(path, true);
      ctx.ui.toast(
        wrote
          ? `Exported ${path.replace(/\.excalidraw$/i, "")}`
          : "Nothing was exported (the drawing is empty or the export failed)",
      );
    });

    ctx.commands.register("export-all", async () => {
      if (ctx.vault.info()?.readOnly) {
        ctx.ui.toast("The vault is read-only");
        return;
      }
      const cfg = config();
      const dirs = [""];
      let done = 0;
      let seen = 0;
      while (dirs.length > 0 && !stopped) {
        const dir = dirs.shift()!;
        let entries;
        try {
          entries = await ctx.vault.list(dir);
        } catch (e) {
          failed(`Listing ${dir || "the vault"}`, e);
          continue;
        }
        for (const entry of entries) {
          if (entry.kind === "folder") {
            if (!isExcluded(entry.path, cfg)) {
              dirs.push(entry.path);
            }
          } else if (!isExcluded(entry.path, cfg)) {
            seen++;
            await tick(ctx);
            if (await exporter.exportNow(entry.path, false)) {
              done++;
            }
          }
        }
      }
      ctx.ui.toast(
        seen === 0
          ? "No drawings found"
          : `Exported ${done} of ${seen} drawings`,
      );
    });
  },
});
