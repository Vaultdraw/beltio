/**
 * The editor's `onPaste`: a paste of plain multi-line text goes to the plugins that asked to see
 * pastes (`ctx.clipboard.onPaste`) before the editor pastes it. Returns false when a plugin handled it.
 * Copied elements, files and images never reach a plugin; a single line costs one `includes`.
 */
import { routePaste } from "../plugins/clipboard/pasteRouter";

/** The parts of the editor's ClipboardData that matter here. */
interface PastedData {
  text?: string;
  elements?: readonly unknown[];
  files?: object;
  mixedContent?: unknown;
}

export async function onEditorPaste(data: PastedData): Promise<boolean> {
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
