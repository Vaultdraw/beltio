import { getNonDeletedElements } from "@excalidraw/element";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

/** Approximate size of the drawing file: element JSON plus file data URLs. */
export const currentDrawingBytes = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles | null | undefined,
): number => {
  let bytes = JSON.stringify(getNonDeletedElements(elements)).length;
  for (const file of Object.values(files ?? {})) {
    bytes += file.dataURL.length;
  }
  return bytes;
};
