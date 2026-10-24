/**
 * Excalidraw action keys as registry commands (command audit, D5). Each row
 * is an Excalidraw action; its default keys equal Excalidraw's own
 * (actionCommands.test.ts checks them against EXCALIDRAW_KEYS), so nothing
 * changes until the user rebinds. The open editor binds the handlers
 * (createActionHandlers) and then tells Excalidraw to skip these actions'
 * built-in keys (`UIOptions.hostActionKeys`), so `[hotkeys]` can rebind or
 * remove them like any other command.
 */
import type { ActionName } from "@excalidraw/excalidraw/actions/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TOOL_KEYS_CONTEXT } from "./toolCommands";

import type { CommandDefinition, CommandHandlers, CommandKeys } from "./types";

interface ActionRow {
  action: ActionName;
  title: string;
  keys: CommandKeys;
  /**
   * Listed by the palette as "Canvas: …". Default false: Excalidraw's own
   * palette entry (editor provider) already lists the action, with its icon,
   * its availability and the user's key, so a second entry would duplicate
   * it. actionCommands.test.ts checks this against commandPaletteItems.tsx.
   */
  ownPaletteEntry?: true;
}

const keys = (...chords: string[]): CommandKeys => ({ default: chords });

/** One row per action; the order is the order on the Hotkeys page. */
export const ACTION_TABLE: readonly ActionRow[] = [
  { action: "alignTop", title: "Align top", keys: keys("Mod+Shift+ArrowUp") },
  {
    action: "alignBottom",
    title: "Align bottom",
    keys: keys("Mod+Shift+ArrowDown"),
  },
  {
    action: "alignLeft",
    title: "Align left",
    keys: keys("Mod+Shift+ArrowLeft"),
  },
  {
    action: "alignRight",
    title: "Align right",
    keys: keys("Mod+Shift+ArrowRight"),
  },
  {
    action: "alignVerticallyCentered",
    title: "Center vertically",
    keys: keys(),
  },
  {
    action: "alignHorizontallyCentered",
    title: "Center horizontally",
    keys: keys(),
  },
  {
    action: "distributeHorizontally",
    title: "Distribute horizontally",
    keys: keys("Alt+H"),
    ownPaletteEntry: true,
  },
  {
    action: "distributeVertically",
    title: "Distribute vertically",
    keys: keys("Alt+V"),
    ownPaletteEntry: true,
  },
  {
    action: "sendBackward",
    title: "Send backward",
    keys: keys("Mod+BracketLeft"),
  },
  {
    action: "bringForward",
    title: "Bring forward",
    keys: keys("Mod+BracketRight"),
  },
  {
    action: "sendToBack",
    title: "Send to back",
    keys: { default: ["Mod+Shift+BracketLeft"], mac: ["Mod+Alt+BracketLeft"] },
  },
  {
    action: "bringToFront",
    title: "Bring to front",
    keys: {
      default: ["Mod+Shift+BracketRight"],
      mac: ["Mod+Alt+BracketRight"],
    },
  },
  {
    action: "flipHorizontal",
    title: "Flip horizontal",
    keys: keys("Shift+H"),
  },
  { action: "flipVertical", title: "Flip vertical", keys: keys("Shift+V") },
  { action: "group", title: "Group selection", keys: keys("Mod+G") },
  { action: "ungroup", title: "Ungroup", keys: keys("Mod+Shift+G") },
  {
    action: "toggleElementLock",
    title: "Lock or unlock selection",
    keys: keys("Mod+Shift+L"),
  },
  { action: "unlockAllElements", title: "Unlock all", keys: keys() },
  {
    action: "duplicateSelection",
    title: "Duplicate selection",
    keys: keys("Mod+D"),
  },
  { action: "copyStyles", title: "Copy styles", keys: keys("Mod+Alt+C") },
  { action: "pasteStyles", title: "Paste styles", keys: keys("Mod+Alt+V") },
  {
    action: "decreaseFontSize",
    title: "Decrease font size",
    keys: keys("Mod+Shift+Comma"),
  },
  {
    action: "increaseFontSize",
    title: "Increase font size",
    keys: keys("Mod+Shift+Period"),
  },
  { action: "hyperlink", title: "Edit element link", keys: keys("Mod+K") },
  { action: "gridMode", title: "Toggle grid", keys: keys("Mod+Quote") },
  {
    action: "objectsSnapMode",
    title: "Toggle snap to objects",
    keys: keys("Alt+S"),
  },
  { action: "zenMode", title: "Toggle zen mode", keys: keys("Alt+Z") },
  { action: "viewMode", title: "Toggle view mode", keys: keys("Alt+R") },
  { action: "stats", title: "Toggle stats", keys: keys("Alt+Slash") },
  { action: "zoomToFit", title: "Zoom to fit all", keys: keys("Shift+1") },
  {
    action: "zoomToFitSelectionInViewport",
    title: "Zoom to fit selection",
    keys: keys("Shift+2"),
  },
  {
    action: "zoomToFitSelection",
    title: "Zoom to selection",
    keys: keys("Shift+3"),
  },
];

/** Passed to Excalidraw as `UIOptions.hostActionKeys` (stable array). */
export const HOST_ACTION_NAMES: readonly ActionName[] = ACTION_TABLE.map(
  (row) => row.action,
);

const HOST_ACTION_SET: ReadonlySet<string> = new Set(HOST_ACTION_NAMES);

/** True when the app owns this Excalidraw action's key (a canvas.* command). */
export const isHostOwnedAction = (action: string): boolean =>
  HOST_ACTION_SET.has(action);

export const actionCommandId = (action: ActionName): string =>
  `canvas.${action}`;

export const ACTION_COMMANDS: CommandDefinition[] = ACTION_TABLE.map((row) => ({
  id: actionCommandId(row.action),
  title: `Canvas: ${row.title}`,
  category: "Canvas",
  keys: row.keys,
  ...(row.ownPaletteEntry ? {} : { palette: false }),
  // Same scope as the tool keys: Excalidraw listened on the document, so the
  // keys work with focus on the body; a focused list, gallery or graph keeps
  // its own keys, and text fields keep theirs (Mod+A, Mod+D ...).
  when: [
    "drawingOpen",
    "!listFocus",
    "!galleryFocus",
    "!graphFocus",
    TOOL_KEYS_CONTEXT,
    "!textEditing",
    "!modalOpen",
  ],
  repeat: false,
}));

/** Handlers for every `canvas.*` command, calling the editor's action hook. */
export function createActionHandlers(
  api: Pick<ExcalidrawImperativeAPI, "runActionShortcut">,
): CommandHandlers {
  return Object.fromEntries(
    ACTION_TABLE.map((row) => [
      actionCommandId(row.action),
      () => {
        api.runActionShortcut(row.action);
      },
    ]),
  );
}
