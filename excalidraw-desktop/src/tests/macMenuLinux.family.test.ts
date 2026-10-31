/**
 * Family hunter shell, linux (2026-10-31): "every action the macOS app menu offers has a way to run
 * it on Linux". macOS gets Quit, Close Tab, Close Window, Full Screen, Minimize and Maximize from
 * the app menu (`src-tauri/src/app_menu.rs`); Linux has no app menu, so each must be a command
 * (palette, rebindable) with its usual Linux key (GNOME and KDE apps, Obsidian, Zed: Ctrl+Q
 * quits, F11 toggles full screen, Ctrl+W closes the tab). A missing member is `it.fails`.
 */
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands/commands";

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

/** macOS menu item -> the command that does it elsewhere, and the Linux key it should have. */
const MEMBERS: {
  item: string;
  id: string;
  key?: string;
  broken?: string;
}[] = [
  { item: "File > Close Tab", id: "tabs.close", key: "Mod+W" },
  { item: "File > Close Window", id: "window.close", key: "Mod+Shift+W" },
  { item: "Window > Minimize", id: "window.minimize" },
  { item: "Window > Maximize", id: "window.toggleMaximize" },
  { item: "Help > Documentation", id: "help.docs" },
  { item: "Help > Keyboard Shortcuts", id: "help.keyboard" },
  { item: "Help > Check for Updates", id: "help.checkUpdates" },
  {
    item: "Vaultdraw > Quit",
    id: "app.quit",
    key: "Mod+Q",
  },
  {
    item: "View > Enter Full Screen",
    id: "window.toggleFullscreen",
    key: "F11",
  },
];

describe("family (linux): the macOS app menu's actions are commands elsewhere", () => {
  for (const m of MEMBERS) {
    (m.broken ? it.fails : it)(
      `${m.item}: command ${m.id}${m.key ? ` on ${m.key}` : ""}${
        m.broken ? ` (${m.broken})` : ""
      }`,
      () => {
        const c = byId.get(m.id);
        expect(c, `command ${m.id} exists`).toBeTruthy();
        if (m.key) {
          expect([...(c!.keys.linux ?? c!.keys.default)].map(String)).toContain(
            m.key,
          );
        }
      },
    );
  }
});
