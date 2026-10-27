/**
 * Toolbar buttons plugins declared (`[[contributes.toolbar]]`). The strip asks
 * `getToolbarButtons()`; with no plugin button that is one shared empty array,
 * so the editor pays nothing without plugins. A click runs the plugin's command
 * like the palette does (no plugin host import: the startup graph stays clean).
 */
import { toastStore } from "../toasts/toastStore";

import { runCommand } from "./menuRegistry";

export interface ToolbarButton {
  pluginId: string;
  pluginName: string;
  /** Tooltip and accessible name. */
  title: string;
  /** SVG path data on a 24 by 24 grid, or null for the first letter of the title. */
  icon: string | null;
  priority: number;
  /** Full command id (`<pluginId>.<command>`). */
  command: string;
  /** Set for a canvas tool: the button shows pressed while that tool is chosen. */
  toolKey?: string;
}

const NONE: readonly ToolbarButton[] = [];
let buttons: readonly ToolbarButton[] = NONE;
const listeners = new Set<() => void>();

const order = (a: ToolbarButton, b: ToolbarButton) =>
  b.priority - a.priority || (a.command < b.command ? -1 : 1);

/** Registers a plugin's buttons; the returned function removes them. */
export function addToolbarButtons(added: readonly ToolbarButton[]): () => void {
  if (added.length === 0) {
    return () => {};
  }
  buttons = [...buttons, ...added].sort(order);
  listeners.forEach((l) => l());
  return () => {
    buttons = buttons.filter((b) => !added.includes(b));
    if (buttons.length === 0) {
      buttons = NONE;
    }
    listeners.forEach((l) => l());
  };
}

export const getToolbarButtons = (): readonly ToolbarButton[] => buttons;

export const subscribeToolbarButtons = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Runs the button's command; a failure is a toast, never a throw into the click. */
export function runToolbarButton(button: ToolbarButton): void {
  try {
    runCommand(button.command);
  } catch (err) {
    toastStore.push({
      message: `${button.pluginName}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      kind: "error",
    });
  }
}
