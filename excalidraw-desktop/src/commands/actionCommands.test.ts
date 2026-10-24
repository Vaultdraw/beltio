import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTION_COMMANDS,
  ACTION_TABLE,
  HOST_ACTION_NAMES,
  createActionHandlers,
  isHostOwnedAction,
} from "./actionCommands";
import { COMMANDS, getCommand } from "./commands";
import { findConflicts } from "./conflicts";
import { readContext } from "./context";
import { defineContextKey } from "./contextKeys";
import { installCommandDispatcher } from "./dispatcher";
import { EXCALIDRAW_KEYS } from "./excalidrawKeys";
import {
  getRegisteredHandler,
  registerCommandHandlers,
} from "./handlerRegistry";
import { buildKeymap, effectiveKeys } from "./keymap";
import { TOOL_KEYS_CONTEXT } from "./toolCommands";

import type { Platform } from "./types";

const PLATFORMS: Platform[] = ["mac", "win", "linux"];

/** Excalidraw's own chords for `action` on `platform`, sorted. */
const excalidrawChords = (action: string, platform: Platform) =>
  EXCALIDRAW_KEYS.filter(
    (k) =>
      k.action === action && (!k.platforms || k.platforms.includes(platform)),
  )
    .map((k) => k.chord)
    .sort();

describe("canvas action commands", () => {
  it("are registered once each, in the Canvas category", () => {
    const ids = ACTION_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ACTION_COMMANDS) {
      expect(getCommand(c.id)).toBe(c);
      expect(c.id).toMatch(/^canvas\.[a-zA-Z]+$/);
      expect(c.category).toBe("Canvas");
      expect(c.title).toMatch(/^Canvas: /);
      expect(c.when).toContain(TOOL_KEYS_CONTEXT);
      expect(c.when).toContain("!textEditing");
    }
    expect(getCommand("canvas.alignTop")?.title).toBe("Canvas: Align top");
    expect(HOST_ACTION_NAMES).toHaveLength(ACTION_TABLE.length);
  });

  it("default to exactly Excalidraw's own keys on every platform", () => {
    for (const row of ACTION_TABLE) {
      const command = getCommand(`canvas.${row.action}`)!;
      for (const platform of PLATFORMS) {
        expect(
          [...effectiveKeys(command, {}, platform)].sort(),
          `${row.action} on ${platform}`,
        ).toEqual(excalidrawChords(row.action, platform));
      }
    }
  });

  it("covers every keyed align, distribute, layer, flip, group and lock action", () => {
    for (const action of [
      "alignTop",
      "alignBottom",
      "alignLeft",
      "alignRight",
      "distributeHorizontally",
      "distributeVertically",
      "sendBackward",
      "bringForward",
      "sendToBack",
      "bringToFront",
      "flipHorizontal",
      "flipVertical",
      "group",
      "ungroup",
      "toggleElementLock",
    ]) {
      expect(isHostOwnedAction(action), action).toBe(true);
    }
    expect(isHostOwnedAction("copy")).toBe(false);
  });

  it("are not flagged against the Excalidraw keys they replace", () => {
    for (const platform of PLATFORMS) {
      const conflicts = findConflicts(COMMANDS, {}, platform);
      const flagged = ACTION_COMMANDS.filter((c) => conflicts.has(c.id));
      expect(
        flagged.map((c) => [c.id, [...conflicts.get(c.id)!.entries()]]),
        platform,
      ).toEqual([]);
    }
  });

  it("handlers call runActionShortcut with the action name", () => {
    const runActionShortcut = vi.fn(() => true);
    const handlers = createActionHandlers({ runActionShortcut });
    expect(Object.keys(handlers).sort()).toEqual(
      ACTION_COMMANDS.map((c) => c.id).sort(),
    );
    handlers["canvas.group"]?.();
    handlers["canvas.alignLeft"]?.();
    expect(runActionShortcut.mock.calls).toEqual([["group"], ["alignLeft"]]);
  });
});

describe("action keys through the real dispatcher", () => {
  let dispose: (() => void) | null = null;
  let unbind: (() => void) | null = null;
  const runActionShortcut = vi.fn(() => true);
  const app = { vaultOpen: true, drawingOpen: true, writable: true };

  const install = (overrides: Record<string, string[]> = {}) => {
    const undefine = defineContextKey(TOOL_KEYS_CONTEXT, () => true);
    const unbindHandlers = registerCommandHandlers(
      createActionHandlers({ runActionShortcut }),
    );
    unbind = () => {
      undefine();
      unbindHandlers();
    };
    const keymap = buildKeymap(COMMANDS, overrides, "mac");
    dispose = installCommandDispatcher(window, {
      platform: "mac",
      getKeymap: () => keymap,
      getContext: () => readContext(document, app),
      getHandler: getRegisteredHandler,
    });
  };

  const press = (code: string, key: string, mods: KeyboardEventInit = {}) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        code,
        key,
        bubbles: true,
        cancelable: true,
        ...mods,
      }),
    );

  beforeEach(() => {
    runActionShortcut.mockClear();
    document.body.innerHTML =
      '<div class="vault-editor"><div id="canvas" tabindex="0"></div></div>';
    document.getElementById("canvas")?.focus();
  });
  afterEach(() => {
    dispose?.();
    unbind?.();
    dispose = unbind = null;
    document.body.innerHTML = "";
  });

  it("Cmd+G groups by default", () => {
    install();
    press("KeyG", "g", { metaKey: true });
    expect(runActionShortcut).toHaveBeenCalledWith("group");
  });

  it("Shift+H flips horizontally, but not while typing", () => {
    install();
    press("KeyH", "H", { shiftKey: true });
    expect(runActionShortcut).toHaveBeenCalledWith("flipHorizontal");
    document.body.insertAdjacentHTML("beforeend", "<input id='i'>");
    document.getElementById("i")?.focus();
    press("KeyH", "H", { shiftKey: true });
    expect(runActionShortcut).toHaveBeenCalledTimes(1);
  });

  it("a rebound action leaves the old key dead and runs on the new one", () => {
    install({ "canvas.group": ["Alt+G"] });
    press("KeyG", "g", { metaKey: true });
    expect(runActionShortcut).not.toHaveBeenCalled();
    press("KeyG", "g", { altKey: true });
    expect(runActionShortcut).toHaveBeenCalledWith("group");
  });

  it("an unbound action ([]) runs on no key", () => {
    install({ "canvas.flipHorizontal": [] });
    press("KeyH", "H", { shiftKey: true });
    expect(runActionShortcut).not.toHaveBeenCalled();
  });
});
