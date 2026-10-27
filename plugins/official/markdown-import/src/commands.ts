/** The palette commands. Every one is rebindable and has no default key. */
import type { Ctx09 } from "./api09";
import type { Importing } from "./main";

export function registerCommands(ctx: Ctx09, imp: Importing): void {
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
  // Called by the core "Import: Cancel": true when a vault import was running.
  reg("cancel-import", () => imp.cancelObsidian());
}
