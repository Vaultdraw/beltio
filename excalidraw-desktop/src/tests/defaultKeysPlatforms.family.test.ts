/**
 * Family hunter shell, linux (2026-10-31): "the default keys work on every platform": no built-in
 * command has a default chord the system or the app menu takes first (so the key can never reach
 * it), and no two built-in commands share a chord that can be live at once, on macOS, Linux and
 * Windows alike. The Hotkeys page shows such a clash for a user's own binding; the defaults must
 * not ship with one. (reserved.ts: Alt+F4, Alt+Tab, the Super key on Linux and Windows; the
 * macOS app menu keys.)
 */
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import { reservedInfo } from "../commands/reserved";

import type { Platform } from "../commands/types";

const PLATFORMS: Platform[] = ["mac", "linux", "win"];

const chordsOf = (platform: Platform) =>
  COMMANDS.flatMap((c) =>
    (c.keys[platform] ?? c.keys.default).map((chord) => ({ id: c.id, chord })),
  );

describe("family (linux): default keys reach their command on every platform", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: no default chord is taken by the system or the app menu`, () => {
      const blocked = chordsOf(platform)
        .filter(({ chord }) => reservedInfo(chord, platform)?.blocked)
        .map(({ id, chord }) => `${id} ${chord}`);
      expect(blocked).toEqual([]);
    });

    it(`${platform}: no two default commands clash`, () => {
      const clashes = [...findConflicts(COMMANDS, {}, platform).keys()];
      expect(clashes).toEqual([]);
    });
  }

  // Keys the common Linux desktops take before any app sees them (GNOME `switch-to-workspace-*`
  // and `screensaver`, XFCE and Cinnamon workspace and terminal keys, every window manager's
  // Alt+F4, Alt+Tab, Alt+Space window menu).
  const LINUX_DESKTOP_KEYS = [
    "Mod+Alt+ArrowLeft",
    "Mod+Alt+ArrowRight",
    "Mod+Alt+ArrowUp",
    "Mod+Alt+ArrowDown",
    "Mod+Alt+T",
    "Mod+Alt+L",
    "Alt+Space",
    "Alt+Escape",
  ];

  it.fails(
    "linux: no default chord is a key the common desktops take (toimprove 321)",
    () => {
      const taken = chordsOf("linux")
        .filter(({ chord }) => LINUX_DESKTOP_KEYS.includes(chord))
        .map(({ id, chord }) => `${id} ${chord}`);
      expect(taken).toEqual([]);
    },
  );

  it.fails(
    "linux: the Hotkeys page warns when a user binds a key the common desktops take (toimprove 321)",
    () => {
      const unwarned = LINUX_DESKTOP_KEYS.filter(
        (chord) => !reservedInfo(chord, "linux"),
      );
      expect(unwarned).toEqual([]);
    },
  );
});
