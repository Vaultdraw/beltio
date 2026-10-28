/**
 * Commands a `vaultdraw://cmd` link may run (an allow list, like VS Code's `command:` links).
 *
 * Anything not listed here is refused for links unless the user lists its exact id in
 * `control.uri_allow`. A new command is therefore NOT link-callable until it is added below:
 * the list fails closed, where a block list fails open. Rust keeps its block list
 * (src-tauri/src/control/uri.rs) as a second check. Keep to harmless view, navigation and
 * settings-opening commands; a link still asks before it runs one.
 */
import { parseDrawingOpenCommandId } from "./drawingCommands";

export const LINK_COMMAND_IDS: readonly string[] = [
  "appearance.toggleMode",
  "appearance.mode.dark",
  "appearance.mode.light",
  "appearance.mode.system",
  "view.toggleNavigator",
  "view.toggleActivityBar",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
  "view.focusMode",
  "navigator.focusSearch",
  "navigator.refresh",
  "settings.open",
  "settings.openHotkeys",
  "links.back",
  "links.forward",
  "library.toggle",
  "vault.newDrawing",
];

const LINKABLE: ReadonlySet<string> = new Set(LINK_COMMAND_IDS);

/** A built-in command that opted in to being run from a link (and `drawing.open:<path>`). */
export const isLinkCommand = (id: string): boolean =>
  LINKABLE.has(id) || parseDrawingOpenCommandId(id) !== null;
