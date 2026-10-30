/**
 * The graph plugin: the commands of plugin.toml, the per-vault settings (`ctx.vault.table`) and
 * the overlay (`ctx.overlays`) that shows the view. Nothing here runs until the first graph
 * command; the view itself (GraphView and the renderer) is a lazy import of its own.
 */
import {
  createElement as h,
  lazy,
  Suspense,
  useSyncExternalStore,
} from "react";

import { definePlugin } from "@vaultdraw/api";

import { GRAPH_COMMAND_IDS, GRAPH_VIEW_IDS } from "./commandIds";
import { createController } from "./controller";
import { installFold } from "./foldHook";
import { runViewCommand } from "./viewBus";

import type { OverlayHandle, OverlayProps } from "@vaultdraw/api";

const GraphView = lazy(() => import("./GraphView"));

const SHORT = (id: string) => id.slice("graph.".length);

export default definePlugin({
  activate(ctx) {
    installFold(ctx.text.fold);
    const controller = createController(ctx);
    let overlay: OverlayHandle | null = null;

    const Overlay = ({ close }: OverlayProps) => {
      const view = useSyncExternalStore(
        controller.subscribe,
        controller.snapshot,
      );
      if (!view.settings) {
        return null;
      }
      return h(
        Suspense,
        { fallback: h("div", { className: "vd-graph", "aria-busy": "true" }) },
        h(GraphView, {
          handle: view.vault,
          currentPath: view.currentPath,
          mode: view.mode,
          onModeChange: controller.setMode,
          settings: view.settings,
          onSettingsChange: controller.commit,
          onOpen: (path: string, target?: "current" | "new") => {
            close();
            void ctx.workspace
              .open(path, { newTab: target === "new" })
              .catch((e: unknown) => ctx.log.warn("open failed", e));
          },
          onClose: close,
          shortcutFor: ctx.workspace.openShortcut,
          themeKey: view.themeKey,
          fitNonce: view.fitNonce,
          source: controller.source,
          onSession: (s: unknown) => {
            (
              globalThis as { __graphOnSession?: (s: unknown) => void }
            ).__graphOnSession?.(s);
          },
        }),
      );
    };

    /** Opens the overlay (settings are read on the first open of a vault, never at startup). */
    const show = async (mode?: "global" | "local") => {
      if (!ctx.vault.info()) {
        return;
      }
      await controller.prepare(mode);
      if (!overlay?.isOpen) {
        overlay = ctx.overlays.open(Overlay, {
          onClose: () => controller.closed(),
        });
      }
    };
    const toggle =
      (flag: "showOrphans" | "showTags" | "showUnresolved") => async () => {
        await show();
        controller.toggleFlag(flag);
      };

    const handlers: Record<string, () => void | Promise<void>> = {
      [GRAPH_COMMAND_IDS.open]: () =>
        overlay?.isOpen ? overlay.close() : show("global"),
      [GRAPH_COMMAND_IDS.openLocal]: () =>
        ctx.workspace.activePath() ? show("local") : undefined,
      [GRAPH_COMMAND_IDS.toggleOrphans]: toggle("showOrphans"),
      [GRAPH_COMMAND_IDS.toggleTags]: toggle("showTags"),
      [GRAPH_COMMAND_IDS.toggleUnresolved]: toggle("showUnresolved"),
      [GRAPH_COMMAND_IDS.fit]: async () => {
        await show();
        controller.fit();
        runViewCommand(GRAPH_COMMAND_IDS.fit);
      },
    };
    for (const id of GRAPH_VIEW_IDS) {
      if (!(id in handlers)) {
        handlers[id] = () => {
          runViewCommand(id);
        };
      }
    }
    for (const [id, run] of Object.entries(handlers)) {
      ctx.commands.register(SHORT(id), run);
    }
    ctx.subscriptions.push({ dispose: () => controller.dispose() });
  },
});
