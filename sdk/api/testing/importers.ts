/**
 * Rules of plugin imports shared by the mock host and the app's host: the
 * size cap, the messages the user sees, the input object an importer gets.
 */
import type { ImportInput, ImportResult, SceneOp } from "@vaultdraw/api";

/** Files over this are refused before the plugin loads (the drawing cap). */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export const importTooBigMessage = (file: string) =>
  `${file} is over 32 MiB, so it was skipped`;
export const importBusyMessage =
  "An import is already running. Wait for it, or run Import: Cancel.";
export const importChangedMessage = (plugin: string) =>
  `${plugin}: the drawing changed during the import (DRAWING_CHANGED), so nothing was added`;
export const importCancelledMessage = (plugin: string) =>
  `${plugin}: the import was cancelled`;
export const importReadOnlyMessage = "This drawing is read-only";
export const importMissingMessage = (plugin: string, id: string) =>
  `${plugin}: importer ${id} declared but not registered`;
export const importFailedMessage = (
  plugin: string,
  file: string,
  why: string,
) => `${plugin}: import of ${file} failed: ${why}`;

/** The file name without any folder part. */
export const baseName = (name: string): string =>
  name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);

/** `ImportInput` over a lazy byte reader; text is UTF-8 with invalid bytes replaced. */
export const makeImportInput = (
  name: string,
  size: number,
  read: () => Promise<Uint8Array>,
): ImportInput => ({
  name: baseName(name),
  size,
  bytes: read,
  async text() {
    return new TextDecoder("utf-8", { fatal: false }).decode(await read());
  },
});

/** The ops of an importer's result, or null when it returned none. */
export const resultOps = (result: ImportResult): readonly SceneOp[] | null =>
  result && typeof result === "object" && Array.isArray(result.ops)
    ? result.ops
    : null;
