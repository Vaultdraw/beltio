/** The rules of a status bar item's state, shared by the app and the test kit. */
import type { StatusBarState } from "@vaultdraw/api";

export const MAX_STATUS_TEXT = 80;
export const MAX_STATUS_TOOLTIP = 200;
export const STATUS_TONES = ["normal", "muted", "warn", "error"] as const;

export interface CleanStatus {
  text: string;
  tooltip: string | null;
  tone: typeof STATUS_TONES[number];
}

const cut = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

/** The state to show, or null when the item is hidden (empty text). Throws on a wrong shape. */
export function cleanStatus(state: StatusBarState): CleanStatus | null {
  if (state === null || typeof state !== "object") {
    throw new TypeError("statusBar.set needs { text }");
  }
  if (typeof state.text !== "string") {
    throw new TypeError("statusBar text must be a string");
  }
  const tone = state.tone ?? "normal";
  if (!STATUS_TONES.includes(tone)) {
    throw new TypeError(
      `statusBar tone must be one of ${STATUS_TONES.join(", ")}`,
    );
  }
  const text = state.text.replace(/\s+/g, " ").trim();
  if (text === "") {
    return null;
  }
  return {
    text: cut(text, MAX_STATUS_TEXT),
    tooltip:
      typeof state.tooltip === "string" && state.tooltip !== ""
        ? cut(state.tooltip, MAX_STATUS_TOOLTIP)
        : null,
    tone,
  };
}

/** Two cleaned states that look the same (the app skips the redraw). */
export const sameStatus = (a: CleanStatus | null, b: CleanStatus | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.text === b.text &&
    a.tooltip === b.tooltip &&
    a.tone === b.tone);
