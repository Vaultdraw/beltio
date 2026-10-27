/**
 * Speculative open: the first half of a drawing switch starts on pointer-down.
 *
 * Pointer-down on a tree row, tab or switcher row to the click is 50-150 ms of
 * idle time. This module reads the file and parses it in that gap, so the
 * click's switch finds both ready. One slot only: a new pointer-down replaces
 * the old entry, a click that never comes lets it expire, and the slot is
 * empty when the feature is off or unused (no listener, no timer, no cache).
 *
 * Correctness: the read is single-use and short-lived, and the parse is only
 * handed to a document whose source text is exactly the text it parsed.
 */
import { loadFromJSONText } from "@excalidraw/excalidraw";

import type { DrawingFile } from "../vault/types";
import type { LoadedScene } from "../editor/sceneSwap";

/** An unclaimed entry is dropped after this. */
export const SPECULATIVE_TTL_MS = 2500;
/** Larger files are read ahead but not parsed ahead (a parse blocks the main thread). */
export const SPECULATIVE_PARSE_MAX_CHARS = 8_000_000;
/** The pointer moving farther than this while down is a drag: nothing is parsed. */
export const SPECULATIVE_DRAG_PX = 6;

/** A parsed file as the editor opens it, before per-document app state. */
export type RawScene = Pick<LoadedScene, "elements" | "files"> & {
  appState: Partial<LoadedScene["appState"]>;
};

type Slot = {
  handle: string;
  path: string;
  file: Promise<DrawingFile>;
  /** Resolves when the parse ran (null: not parsed, failed or cancelled). */
  scene: Promise<{ json: string; raw: RawScene } | null>;
  readTaken: boolean;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout>;
};

let slot: Slot | null = null;

const clear = (s: Slot | null) => {
  if (!s) {
    return;
  }
  s.cancelled = true;
  clearTimeout(s.timer);
  if (slot === s) {
    slot = null;
  }
};

/** Drops the entry (the pointer turned into a drag, the vault changed, tests). */
export const discardSpeculativeOpen = () => clear(slot);

/** True while an entry is held (tests, diagnostics). */
export const hasSpeculativeOpen = () => slot !== null;

/**
 * Starts reading `path`, then parsing it. Replaces any earlier entry. The
 * caller has already checked that `path` is not the open drawing.
 */
export const startSpeculativeOpen = (
  handle: string,
  path: string,
  read: (handle: string, path: string) => Promise<DrawingFile>,
): void => {
  if (slot && slot.handle === handle && slot.path === path && !slot.readTaken) {
    return;
  }
  clear(slot);
  const file = read(handle, path);
  // an unclaimed failed read must not surface as an unhandled rejection
  file.catch(() => {});
  const s: Slot = {
    handle,
    path,
    file,
    scene: Promise.resolve(null),
    readTaken: false,
    cancelled: false,
    timer: setTimeout(() => clear(s), SPECULATIVE_TTL_MS),
  };
  s.scene = file.then(
    async ({ json }) => {
      if (s.cancelled || json.length > SPECULATIVE_PARSE_MAX_CHARS) {
        return null;
      }
      // own task: the pointer-up and the click that follow are not queued behind it
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (s.cancelled) {
        return null;
      }
      try {
        const parsed = loadFromJSONText(json, null, null);
        return {
          json,
          raw: {
            elements: parsed.elements,
            appState: parsed.appState,
            files: parsed.files,
          },
        };
      } catch {
        return null; // the real open reports the broken file
      }
    },
    () => null,
  );
  slot = s;
};

/**
 * The read started for this document, once: a second call, another vault or
 * another path gets null and reads normally.
 */
export const takeSpeculativeRead = (
  handle: string,
  path: string,
): Promise<DrawingFile> | null => {
  const s = slot;
  if (!s || s.handle !== handle || s.path !== path || s.readTaken) {
    return null;
  }
  s.readTaken = true;
  return s.file;
};

/**
 * The parse of exactly this source text, once, or null (nothing started, text
 * differs, parse skipped). Waits for a parse still running.
 */
export const takeSpeculativeScene = async (
  json: string,
): Promise<RawScene | null> => {
  const s = slot;
  if (!s || !s.readTaken) {
    return null;
  }
  const result = await s.scene;
  // claimed or not, this entry has served its click
  clear(s);
  return result && result.json === json ? result.raw : null;
};
