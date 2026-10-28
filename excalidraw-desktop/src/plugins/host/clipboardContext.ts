/** `ctx.clipboard` (API 0.28.0): the permission `clipboard` is checked on every call. */
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";
import { addPasteHandler } from "../clipboard/pasteRouter";

import { reportPluginError } from "./errors";

import type { ClipboardApi, Disposable } from "../api";
import type { PluginRuntime } from "./types";

export function createClipboardApi(
  rt: PluginRuntime,
  track: (fn: () => void) => Disposable,
  isLive: () => boolean,
): ClipboardApi {
  const id = rt.info.id;
  const need = (method: string) =>
    requirePermission(id, rt.info.permissions, method, "clipboard");
  return {
    async readText() {
      need("clipboard.readText");
      try {
        return (await navigator.clipboard.readText()) ?? "";
      } catch {
        return "";
      }
    },
    onPaste(cb) {
      need("clipboard.onPaste");
      return track(
        addPasteHandler(id, async (event) => {
          // Checked per paste: an update can remove the permission.
          if (!isLive() || !rt.info.permissions.includes("clipboard")) {
            return undefined;
          }
          try {
            return await cb({ text: event.text });
          } catch (e) {
            reportPluginError(id, e, "clipboard.onPaste");
            return undefined;
          }
        }),
      );
    },
  };
}
