/**
 * The editor's `onPaste`: a paste of plain multi-line text goes to the plugins that asked to see
 * pastes (`ctx.clipboard.onPaste`) before the editor pastes it. Returns false when a plugin handled it.
 * Copied elements, files and images never reach a plugin; a single line costs one `includes`.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { routePaste } from "../plugins/clipboard/pasteRouter";

/** The parts of the editor's ClipboardData that matter here. */
interface PastedData {
  text?: string;
  elements?: readonly unknown[];
  files?: object;
  mixedContent?: unknown;
}

export async function onEditorPaste(
  data: PastedData,
  api?: ExcalidrawImperativeAPI | null,
): Promise<boolean> {
  // A picture from the web pastes as a picture (pasteWebImage.ts, loaded on first such paste).
  if (
    api &&
    !data.elements?.length &&
    !(data.files && Object.keys(data.files).length > 0) &&
    (Array.isArray(data.mixedContent) ||
      /^\s*https?:\/\/\S+\s*$/i.test(data.text ?? ""))
  ) {
    const { pasteWebPictures } = await import("./pasteWebImage");
    if (await pasteWebPictures(api, data)) {
      return false;
    }
  }
  const text = data.text;
  if (
    !text ||
    data.elements?.length ||
    data.mixedContent ||
    (data.files && Object.keys(data.files).length > 0)
  ) {
    return true;
  }
  return !(await routePaste(text));
}
