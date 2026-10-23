/**
 * Test helper: the real window dispatcher with the built-in keymap, so a
 * component test's keyDown reaches `list.*` commands as it does in the app.
 */
import { fireEvent } from "@testing-library/react";

import { BUILTIN_COMMANDS } from "./commands";
import { readContext } from "./context";
import { installCommandDispatcher } from "./dispatcher";
import { getRegisteredHandler } from "./handlerRegistry";
import { buildKeymap } from "./keymap";

import type { Platform } from "./types";

export function installListKeysForTests(
  platform: Platform = "mac",
  win: Window = window,
): () => void {
  const keymap = buildKeymap(BUILTIN_COMMANDS, {}, platform);
  return installCommandDispatcher(win, {
    platform,
    getKeymap: () => keymap,
    getContext: () =>
      readContext(win.document, {
        vaultOpen: true,
        drawingOpen: true,
        writable: true,
      }),
    getHandler: getRegisteredHandler,
  });
}

/**
 * Focus `el` (unless focus is already inside it) and press `key` there, the
 * way a user would; upper-case letters carry Shift as on a real keyboard.
 */
export function pressListKey(
  el: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  if (!el.contains(el.ownerDocument.activeElement)) {
    el.focus();
  }
  const shiftKey =
    init.shiftKey ?? (key.length === 1 && key !== key.toLowerCase());
  // fireEvent wraps the dispatch in act(), so React state is flushed.
  fireEvent.keyDown(el, { key, ...init, shiftKey });
}
