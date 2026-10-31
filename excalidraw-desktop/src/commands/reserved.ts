/**
 * Keys the OS, the app menu or text fields already use. The Hotkeys page accepts them
 * (the user decides, like VS Code and Obsidian) and shows the clash on the row.
 */
import { normalizeChord } from "./keys";

import type { Chord, Platform } from "./types";

const MAC_ONLY: ReadonlyMap<Chord, string> = new Map([
  ["Mod+Tab", "macOS switches applications with this key"],
  ["Mod+Space", "macOS opens Spotlight with this key"],
  ["Mod+Ctrl+Space", "macOS opens the emoji picker with this key"],
  ["Mod+Backquote", "macOS cycles windows with this key"],
  ["Mod+Alt+Escape", "macOS opens Force Quit with this key"],
  ["Mod+Ctrl+Q", "macOS locks the screen with this key"],
  ["Mod+Shift+3", "macOS takes screenshots with this key"],
  ["Mod+Shift+4", "macOS takes screenshots with this key"],
  ["Mod+Shift+5", "macOS takes screenshots with this key"],
  ["Mod+Q", "the app menu quits Vaultdraw with this key"],
  ["Mod+H", "the app menu hides Vaultdraw with this key"],
  ["Mod+Alt+H", "the app menu hides other applications with this key"],
  ["Mod+M", "the app menu minimizes the window with this key"],
  ["Mod+Shift+W", "the app menu closes the window with this key"],
  ["Mod+Ctrl+F", "the app menu toggles full screen with this key"],
]);

const OTHER_ONLY: ReadonlyMap<Chord, string> = new Map([
  ["Alt+F4", "the system closes the window with this key"],
  ["Alt+Tab", "the system switches windows with this key"],
  ["Mod+Alt+Delete", "the system security screen uses this key"],
]);

/**
 * Keys the common Linux desktops take by default (GNOME `switch-to-workspace-*` and lock screen,
 * Xfce and Cinnamon workspaces and terminal, the window menu). Not every desktop does, so the
 * Hotkeys page warns but does not refuse (toimprove 321).
 */
const LINUX_DESKTOP: ReadonlyMap<Chord, string> = new Map(
  [
    ["Mod+Alt+ArrowLeft", "switch workspaces"],
    ["Mod+Alt+ArrowRight", "switch workspaces"],
    ["Mod+Alt+ArrowUp", "switch workspaces"],
    ["Mod+Alt+ArrowDown", "switch workspaces"],
    ["Mod+Alt+T", "open a terminal"],
    ["Mod+Alt+L", "lock the screen"],
    ["Alt+Space", "open the window menu"],
    ["Alt+Escape", "cycle windows"],
  ].map(([chord, what]) => [
    chord,
    `many Linux desktops (GNOME, Xfce, Cinnamon) ${what} with this key, so it may never reach Vaultdraw`,
  ]),
);

const TEXT_FIELD: ReadonlyMap<Chord, string> = new Map(
  [
    ["Mod+C", "copy"],
    ["Mod+X", "cut"],
    ["Mod+V", "paste"],
    ["Mod+Z", "undo"],
    ["Mod+A", "select all"],
    ["Mod+Shift+Z", "redo"],
  ].map(([chord, name]) => [
    chord,
    `it is the standard key for ${name}, and this binding takes it over, text fields included`,
  ]),
);

export interface ReservedInfo {
  reason: string;
  /** The system or the app menu takes the key before Vaultdraw sees it, so a binding cannot work. */
  blocked: boolean;
}

/** What `chord` clashes with outside the command list, or null when nothing. */
export function reservedInfo(
  chord: Chord,
  platform: Platform,
): ReservedInfo | null {
  const normalized = normalizeChord(chord, platform);
  const system =
    platform === "mac"
      ? MAC_ONLY.get(normalized)
      : OTHER_ONLY.get(normalized) ??
        (/(^|\+)Meta\+/.test(normalized)
          ? "the Windows/Super key is reserved by the system"
          : undefined);
  if (system) {
    return { reason: system, blocked: true };
  }
  const desktop =
    platform === "linux" ? LINUX_DESKTOP.get(normalized) : undefined;
  if (desktop) {
    return { reason: desktop, blocked: false };
  }
  const text = TEXT_FIELD.get(normalized);
  return text ? { reason: text, blocked: false } : null;
}

/** The clash text of `reservedInfo`, or null; kept for callers that only need the words. */
export const reservedReason = (chord: Chord, platform: Platform) =>
  reservedInfo(chord, platform)?.reason ?? null;
