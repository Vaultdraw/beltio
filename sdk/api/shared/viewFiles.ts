/** An in-memory set of notes for the test kit's views: the same revision rule as the app's `write_note`. */
import { requirePermission } from "./vaultPaths";

import type { ViewFile } from "@vaultdraw/api";

export interface ViewNotes {
  seed(path: string, text: string): void;
  text(path: string): string | undefined;
  file(
    pluginId: string,
    permissions: readonly string[],
    path: string,
  ): ViewFile;
}

/** A stable stand-in for the file's hash (not cryptographic). */
const revisionOf = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").repeat(8);
};

export function createViewNotes(): ViewNotes {
  const notes = new Map<string, string>();
  return {
    seed: (path, text) => void notes.set(path, text),
    text: (path) => notes.get(path),
    file: (pluginId, permissions, path) => ({
      async read() {
        requirePermission(
          pluginId,
          permissions,
          "views file.read",
          "vault.read",
        );
        const text = notes.get(path);
        if (text === undefined) {
          throw new Error("Note not found");
        }
        return { text, revision: revisionOf(text) };
      },
      async write(text, expectedRevision) {
        requirePermission(
          pluginId,
          permissions,
          "views file.write",
          "vault.write",
        );
        const current = notes.get(path);
        if (current === undefined || revisionOf(current) !== expectedRevision) {
          throw Object.assign(
            new Error("Note changed on disk; save was not applied"),
            { code: "CONFLICT" },
          );
        }
        notes.set(path, text);
        return { revision: revisionOf(text) };
      },
    }),
  };
}
