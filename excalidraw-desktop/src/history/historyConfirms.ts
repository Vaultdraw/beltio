import { stripDrawingExt } from "../vault/fileKind";

/** Wording of the destructive history confirmations (command, panel, settings). */

/** "Sketches/plan.excalidraw" -> "plan". */
export const drawingName = (path: string): string =>
  stripDrawingExt(path.split("/").pop() ?? path);

export const deleteAllConfirm = (path: string) => ({
  title: "Delete all history",
  message: `Delete all history of ${drawingName(
    path,
  )}? This removes every version and checkpoint of this drawing on all synced devices.`,
  confirmLabel: "Delete all history",
  isDanger: true,
});

export const deleteCheckpointConfirm = (label: string) => ({
  title: "Delete checkpoint",
  message: `Delete ${label}? It will be removed on all synced devices.`,
  confirmLabel: "Delete checkpoint",
  isDanger: true,
});

export const GIT_EXCLUDED_MESSAGE = "History is now excluded from git";
export const GIT_NOTICE_TEXT =
  "This vault is a git repository. History is stored in it and would be committed with your drawings.";
