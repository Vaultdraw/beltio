import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "./commands";
import { readContext } from "./context";
import { installCommandDispatcher } from "./dispatcher";
import {
  getRegisteredHandler,
  registerCommandHandlers,
} from "./handlerRegistry";
import { buildKeymap } from "./keymap";
import { TOOL_COMMANDS, TOOL_TABLE, createToolHandlers } from "./toolCommands";

const app = { vaultOpen: true, drawingOpen: true, writable: true };

describe("tool commands", () => {
  it("are registered with the planned ids, defaults and rules", () => {
    const defaults = Object.fromEntries(
      TOOL_COMMANDS.map((c) => [c.id, c.keys.default]),
    );
    expect(defaults).toEqual({
      "tool.selection": ["V", "1"],
      "tool.rectangle": ["R", "2"],
      "tool.diamond": ["D", "3"],
      "tool.ellipse": ["O", "4"],
      "tool.arrow": ["A", "5"],
      "tool.line": ["L", "6"],
      "tool.freedraw": ["P", "X", "7"],
      "tool.text": ["T", "8"],
      "tool.stickynote": ["N"],
      "tool.image": ["9"],
      "tool.eraser": ["E", "0"],
      "tool.hand": ["H"],
      "tool.frame": ["F"],
      "tool.autoshape": ["Shift+X"],
      "tool.laser": ["K"],
      "tool.bucketfill": ["B"],
      "tool.lock": ["Q"],
    });
    for (const c of TOOL_COMMANDS) {
      expect(getCommand(c.id)).toBe(c);
      expect(c.category).toBe("Tools");
      expect(c.when).toEqual([
        "drawingOpen",
        "!listFocus",
        "!galleryFocus",
        "!graphFocus",
        "!textEditing",
        "!modalOpen",
      ]);
      expect(c.repeat).toBe(false);
      expect(c.palette).not.toBe(false);
    }
    expect(getCommand("tool.rectangle")?.title).toBe("Tool: Rectangle");
    expect(getCommand("tool.lock")?.title).toBe("Tool: Keep tool active");
    expect(getCommand("tool.autoshape")?.title).toBe("Tool: Shape recognition");
  });

  it("share no default key with another command that can run on the canvas", () => {
    const toolKeys = new Set(TOOL_COMMANDS.flatMap((c) => c.keys.default));
    const others = COMMANDS.filter((c) => !c.id.startsWith("tool.")).filter(
      (c) =>
        // list.* keys (j, k, r, d...) need listFocus, never canvasFocus
        !c.when?.includes("listFocus") &&
        !c.when?.includes("galleryFocus") &&
        !c.when?.includes("graphFocus") &&
        Array.isArray(c.keys.default) &&
        c.keys.default.some((k) => toolKeys.has(k)),
    );
    expect(others.map((c) => c.id)).toEqual([]);
  });

  it("handlers call activateToolShortcut with the right arguments", () => {
    const activateToolShortcut = vi.fn(() => true);
    const handlers = createToolHandlers({ activateToolShortcut });
    expect(Object.keys(handlers).sort()).toEqual(
      TOOL_COMMANDS.map((c) => c.id).sort(),
    );
    handlers["tool.rectangle"]?.();
    handlers["tool.image"]?.();
    handlers["tool.lock"]?.();
    expect(activateToolShortcut.mock.calls).toEqual([
      ["rectangle", "letter"],
      ["image", "digit"],
      ["lock", "letter"],
    ]);
    for (const row of TOOL_TABLE) {
      handlers[`tool.${row.tool}`]?.();
    }
    expect(activateToolShortcut).toHaveBeenCalledTimes(3 + TOOL_TABLE.length);
  });
});

describe("tool keys through the real dispatcher", () => {
  let dispose: (() => void) | null = null;
  let unbind: (() => void) | null = null;
  const activate = vi.fn(() => true);

  const install = (overrides: Record<string, string[]> = {}) => {
    unbind = registerCommandHandlers(
      createToolHandlers({ activateToolShortcut: activate }),
    );
    const keymap = buildKeymap(COMMANDS, overrides, "mac");
    dispose = installCommandDispatcher(window, {
      platform: "mac",
      getKeymap: () => keymap,
      getContext: () => readContext(document, app),
      getHandler: getRegisteredHandler,
    });
  };

  const press = (code: string, key: string) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        code,
        key,
        bubbles: true,
        cancelable: true,
      }),
    );

  beforeEach(() => {
    activate.mockClear();
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

  it("R activates the rectangle tool on the canvas", () => {
    install();
    press("KeyR", "r");
    expect(activate).toHaveBeenCalledWith("rectangle", "letter");
  });

  it("does nothing while typing in a text field", () => {
    install();
    document.body.insertAdjacentHTML("beforeend", "<input id='i'>");
    document.getElementById("i")?.focus();
    press("KeyR", "r");
    expect(activate).not.toHaveBeenCalled();
  });

  it("rebinding R away leaves R dead and the new key active", () => {
    install({ "tool.rectangle": ["G"] });
    press("KeyR", "r");
    expect(activate).not.toHaveBeenCalled();
    press("KeyG", "g");
    expect(activate).toHaveBeenCalledWith("rectangle", "letter");
    // the digit default moved too: the override replaces the whole list
    press("Digit2", "2");
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
