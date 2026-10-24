/**
 * Scene version for `ifVersion`: a hash of id and element version of every
 * non-deleted element, in scene order. Unlike a version sum it ignores deleted
 * elements (saved files drop them), so a file and the live scene agree.
 */
import { getSceneVersion } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

/** cyrb53 over UTF-16 code units (a mirror must hash code units, not bytes). */
export const cyrb53 = (str: string): number => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

type Versioned = Pick<ExcalidrawElement, "id" | "version" | "isDeleted">;

/** Uncached: "s" + base-36 cyrb53 of `id \0 version \1` per live element. */
export const hashScene = (els: readonly Versioned[]): string => {
  let s = "";
  for (const el of els) {
    if (!el.isDeleted) {
      s += `${el.id}\u0000${el.version}\u0001`;
    }
  }
  return `s${cyrb53(s).toString(36)}`;
};

let cachedFor: readonly ExcalidrawElement[] | null = null;
let cachedKey = NaN;
let cached = "";

/** Cached on (array identity, getSceneVersion): O(n) check, one hash per change. */
export const sceneVersion = (els: readonly ExcalidrawElement[]): string => {
  const key = getSceneVersion(els);
  if (els === cachedFor && key === cachedKey) {
    return cached;
  }
  cached = hashScene(els);
  cachedFor = els;
  cachedKey = key;
  return cached;
};
