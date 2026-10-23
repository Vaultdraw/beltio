/**
 * Tool keys as registry commands (keys feature, D5). The defaults equal
 * Excalidraw's own tool keys (excalidrawKeys.test.ts checks this table against
 * `TOOLS`), but the keys now go through the dispatcher, so they can be
 * rebound or removed in `[hotkeys]` like any other command. The open editor
 * binds the handlers (createToolHandlers) and then turns Excalidraw's built-in
 * tool letters off (`UIOptions.toolShortcuts: false`).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { CommandDefinition, CommandHandlers } from "./types";

type ToolArg = Parameters<ExcalidrawImperativeAPI["activateToolShortcut"]>[0];

interface ToolRow {
  /** Excalidraw tool type, or "lock" for the keep-tool-active toggle. */
  tool: ToolArg;
  title: string;
  keys: string[];
}

/** One row per tool; the order is the order on the Hotkeys page. */
/**
 * Custom context key defined by the editor while tool keys are bound: false in
 * a history preview and while link hints take letters. The dispatcher runs
 * before those, so the command itself must stand down.
 */
export const TOOL_KEYS_CONTEXT = "keys.toolKeys";

export const TOOL_TABLE: readonly ToolRow[] = [
  { tool: "selection", title: "Selection", keys: ["V", "1"] },
  { tool: "rectangle", title: "Rectangle", keys: ["R", "2"] },
  { tool: "diamond", title: "Diamond", keys: ["D", "3"] },
  { tool: "ellipse", title: "Ellipse", keys: ["O", "4"] },
  { tool: "arrow", title: "Arrow", keys: ["A", "5"] },
  { tool: "line", title: "Line", keys: ["L", "6"] },
  { tool: "freedraw", title: "Draw", keys: ["P", "X", "7"] },
  { tool: "text", title: "Text", keys: ["T", "8"] },
  { tool: "stickynote", title: "Sticky note", keys: ["N"] },
  { tool: "image", title: "Image", keys: ["9"] },
  { tool: "eraser", title: "Eraser", keys: ["E", "0"] },
  { tool: "hand", title: "Hand", keys: ["H"] },
  { tool: "frame", title: "Frame", keys: ["F"] },
  { tool: "autoshape", title: "Shape recognition", keys: ["Shift+X"] },
  { tool: "laser", title: "Laser pointer", keys: ["K"] },
  { tool: "bucketfill", title: "Bucket fill", keys: ["B"] },
  { tool: "lock", title: "Keep tool active", keys: ["Q"] },
];

export const toolCommandId = (tool: ToolArg): string => `tool.${tool}`;

/** The handler has no event: a tool reachable only by a digit reports "digit". */
const viaFor = (row: ToolRow): "letter" | "digit" =>
  row.keys.every((key) => /^\d$/.test(key)) ? "digit" : "letter";

export const TOOL_COMMANDS: CommandDefinition[] = TOOL_TABLE.map((row) => ({
  id: toolCommandId(row.tool),
  title: `Tool: ${row.title}`,
  category: "Tools",
  keys: { default: row.keys },
  // Not canvasFocus: Excalidraw listened on the document, so tool letters work
  // with focus on the body (after a dialog closes). A focused list, gallery or graph keeps its keys.
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

/** Handlers for every `tool.*` command, calling the editor's tool hook. */
export function createToolHandlers(
  api: Pick<ExcalidrawImperativeAPI, "activateToolShortcut">,
): CommandHandlers {
  return Object.fromEntries(
    TOOL_TABLE.map((row) => {
      const via = viaFor(row);
      return [
        toolCommandId(row.tool),
        () => {
          api.activateToolShortcut(row.tool, via);
        },
      ];
    }),
  );
}
