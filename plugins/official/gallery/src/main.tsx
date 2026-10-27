/**
 * gallery: a keyboard-driven grid of drawing thumbnails for a folder. An official, bundled
 * plugin: it covers the drawing area as an overlay (ctx.overlays), lists folders with
 * ctx.workspace.useFolder and draws previews from the app's thumbnail service
 * (ctx.thumbnails), so it holds no cache of its own.
 */
import { definePlugin } from "@vaultdraw/api";
import { useCallback, useState } from "react";

import galleryCss from "./gallery.css";
import GalleryView from "./GalleryView";
import { GALLERY_COMMAND_IDS } from "./commands";
import thumbsCss from "./thumbs.css";
import { runGridCommand } from "./useViewCommands";

import type { OverlayHandle, PluginContext } from "@vaultdraw/api";

const parentOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** The folder state around the view: the folder shown and the one we just left (selected first). */
function Gallery({
  ctx,
  start,
  close,
}: {
  ctx: PluginContext;
  start: string;
  close: () => void;
}) {
  const [folder, setFolder] = useState(start);
  const [from, setFrom] = useState<string | null>(null);
  const items = ctx.workspace.useFolder(folder);
  const show = useCallback(
    (target: string, comingFrom: string | null = null) => {
      setFrom(comingFrom);
      setFolder(target);
    },
    [],
  );
  if (items === undefined) {
    return <div className="vd-gallery" aria-busy="true" />;
  }
  return (
    <GalleryView
      key={folder}
      ctx={ctx}
      folder={folder}
      vaultName={ctx.vault.info()?.name ?? ""}
      items={items}
      initialPath={from}
      onOpenDrawing={(path) => {
        close();
        void ctx.workspace.open(path);
      }}
      onOpenFolder={(path) => show(path)}
      onParent={() => show(parentOf(folder), folder)}
      onClose={close}
    />
  );
}

export default definePlugin({
  activate(ctx) {
    let shown: OverlayHandle | null = null;
    const style = (css: string) => {
      const el = document.createElement("style");
      el.textContent = css;
      document.head.appendChild(el);
      ctx.subscriptions.push({ dispose: () => el.remove() });
    };
    style(`${thumbsCss}${galleryCss}`);

    const open = (folder: string) => {
      shown?.close();
      const handle = ctx.overlays.open(
        ({ close }) => <Gallery ctx={ctx} start={folder} close={close} />,
        {
          onClose: () => {
            if (shown === handle) {
              shown = null;
            }
          },
        },
      );
      shown = handle;
    };
    const currentFolder = () => parentOf(ctx.workspace.activePath() ?? "");

    ctx.commands.register("toggle", () => {
      if (shown?.isOpen) {
        shown.close();
      } else {
        open(currentFolder());
      }
    });
    ctx.commands.register("show-folder", () => {
      // From a folder's context menu the target is that folder; else the open drawing's folder.
      const target = ctx.menus.target();
      open(
        target?.kind === "folder" && target.path !== null
          ? target.path
          : currentFolder(),
      );
    });
    for (const id of GALLERY_COMMAND_IDS) {
      ctx.commands.register(id, () => runGridCommand(id));
    }
  },
});
