/**
 * Applies the `[memory]` settings to the mounted editor (undo horizon, freeing
 * image data nothing can bring back) and binds `memory.freeUnusedImages`.
 * Nothing runs until the editor's own idle pass; this only sets two options.
 */
import { useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { MEMORY_COMMAND_IDS } from "../commands/memoryCommands";
import { toastStore } from "../toasts/toastStore";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import type { RefObject } from "react";

const TOAST_MS = 4000;
const MB = 2 ** 20;

/** Toast text for a manual free: how many images went and roughly how much. */
export const freedMessage = (released: number, bytes: number): string =>
  released === 0
    ? "No unused images to free"
    : `Freed ${released} unused image${released === 1 ? "" : "s"} (${(
        bytes / MB
      ).toFixed(1)} MB)`;

export function useMemoryRetention({
  apiRef,
  active,
}: {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  active: boolean;
}): void {
  useEffect(() => {
    const api = apiRef.current;
    if (!active || !api) {
      return;
    }
    const apply = () => {
      const p = getPreferences();
      api.setFilesRetention({
        freeUnreachable: p.memoryFreeUnusedImages,
        undoSteps: p.memoryUndoSteps,
      });
    };
    apply();
    const off = subscribePreferences(apply);
    const unbind = registerCommandHandlers({
      [MEMORY_COMMAND_IDS.freeUnusedImages]: () => {
        const { released, bytes } = api.releaseUnusedFiles({ graceMs: 0 });
        toastStore.push({
          message: freedMessage(released, bytes),
          durationMs: TOAST_MS,
        });
      },
    });
    return () => {
      off();
      unbind();
      // an editor going away must not keep a stale horizon for the next one
      if (!api.isDestroyed) {
        api.setFilesRetention({ freeUnreachable: false, undoSteps: 0 });
      }
    };
  }, [apiRef, active]);
}
