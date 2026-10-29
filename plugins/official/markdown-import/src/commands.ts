/** The palette commands. Every one is rebindable and has no default key. */
import { attachImages, downloadImages } from "./boxes";
import { reimportOne, reimportUnchanged } from "./reimport";

import type { PluginContext } from "@vaultdraw/api";
import type { Importing } from "./main";

export function registerCommands(ctx: PluginContext, imp: Importing): void {
  const reg = (id: string, run: () => void | Promise<void> | boolean) =>
    ctx.subscriptions.push(
      ctx.commands.register(id, run as () => void | Promise<void>),
    );
  reg("import", () => imp.pickAndImport());
  reg("import-clipboard", () => imp.importClipboard(false));
  reg("import-document-font", () => imp.pickWithDocumentFont());
  reg("next-heading", () => imp.jumpHeading(1));
  reg("previous-heading", () => imp.jumpHeading(-1));
  reg("timings", () => imp.showTimings());
  reg("obsidian", () => imp.importObsidian("vaultFolder"));
  reg("obsidian-new-vault", () => imp.importObsidian("newVault"));
  reg("download-images", () => downloadImages(ctx));
  // Run by the app when an imported note with web-picture boxes opens: fills them quietly.
  reg("fill-web-images", () => downloadImages(ctx, true));
  reg("attach-images", () => attachImages(ctx));
  reg("reimport-note", () => reimportOne(ctx));
  reg("reimport-notes", () => reimportUnchanged(ctx));
  // Called by the core "Import: Cancel": true when a vault import was running.
  reg("cancel-import", () => imp.cancelObsidian());
}
