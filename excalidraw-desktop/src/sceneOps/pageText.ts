/**
 * Elements from laid-out page items (plugin API 0.9.0) without measuring:
 * the shared builder (sdk/api/shared/pageItems.ts) makes plain records in
 * the editor's shape; this file gives it the editor's ids and seeds and
 * types the result. One pass, linear time, no canvas.
 */
import { randomId, randomInteger } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import {
  buildPageElements,
  hashPageImages,
  sha1Hex,
  type BuildPageOptions,
} from "../../../sdk/api/shared/pageItems";

import type { PageItem, PageRequest } from "../plugins/api";

export interface PageBuild {
  elements: ExcalidrawElement[];
  files: BinaryFileData[];
}

/** Image items (by identity) to file ids; call once per batch before building. */
export const hashPageItemImages = (
  items: readonly PageItem[],
): Promise<ReadonlyMap<object, string>> => hashPageImages(items, sha1Hex);

/**
 * Builds validated items. `known` are file ids the drawing already holds, so
 * a picture that is there is not encoded again.
 */
export const buildPageItems = (
  items: readonly PageItem[],
  options: {
    setup?: PageRequest;
    dataKey?: string;
    fileIds?: ReadonlyMap<object, string>;
    /** Group name to group id, shared by every call of one drawing. */
    groups?: Map<string, string>;
  },
  known: ReadonlySet<string> = new Set(),
): PageBuild => {
  const build: BuildPageOptions = {
    ...options,
    id: randomId,
    seed: randomInteger,
    now: Date.now,
  };
  const out = buildPageElements(items, build, known);
  return {
    elements: out.elements as unknown as ExcalidrawElement[],
    files: out.files as unknown as BinaryFileData[],
  };
};
