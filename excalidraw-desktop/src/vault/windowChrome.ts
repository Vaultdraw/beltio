/**
 * Linux window chrome. With `[window] decorations = "custom"` (the Linux
 * default) the native side creates the window without the system title bar and
 * says so through `window.__VAULTDRAW_CHROME__` (an initialization script, so
 * no startup IPC). The in-app header then carries the window buttons.
 * macOS keeps its overlay title bar and Windows its own; none of this runs there.
 */

export type WindowDecorations = "custom" | "native";

export const isWindowDecorations = (v: unknown): v is WindowDecorations =>
  v === "custom" || v === "native";

/** Class on <html> while the in-app header is the window's only title bar. */
export const CUSTOM_CHROME_CLASS = "vault-linux-custom";

type ChromeWindow = Window & { __VAULTDRAW_CHROME__?: unknown };

/** True when the native side created an undecorated window for us. */
export const isCustomChrome = (win: Window | null | undefined): boolean =>
  !!win && (win as ChromeWindow).__VAULTDRAW_CHROME__ === "custom";

/** Marks <html> for the header CSS; returns whether custom chrome is on. */
export const applyChromeClass = (
  doc: Document,
  win: Window | null,
): boolean => {
  const on = isCustomChrome(win);
  if (on) {
    doc.documentElement.classList.add(CUSTOM_CHROME_CLASS);
  }
  return on;
};

export type WindowAction =
  | "minimize"
  | "toggleMaximize"
  | "toggleFullscreen"
  | "close";

/** Runs one window action through the Tauri window API (loaded on first use). */
export const runWindowAction = async (action: WindowAction): Promise<void> => {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  if (action === "minimize") {
    await current.minimize();
  } else if (action === "toggleMaximize") {
    await current.toggleMaximize();
  } else if (action === "toggleFullscreen") {
    await current.setFullscreen(!(await current.isFullscreen()));
  } else {
    await current.close();
  }
};
