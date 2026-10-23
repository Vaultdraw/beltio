import { afterEach, describe, expect, it, vi } from "vitest";

import { readContext } from "./context";
import {
  cancelPendingSequence,
  installCommandDispatcher,
  pauseDispatcher,
} from "./dispatcher";
import { buildKeymap } from "./keymap";
import { buildKeyTrie } from "./keyTrie";
import { getPendingKeys } from "./pendingKeys";

import type { KeyOptions } from "./keySequence";
import type { CommandDefinition, CommandHandler } from "./types";

const app = { vaultOpen: true, drawingOpen: true, writable: true };
const cmd = (
  id: string,
  keys: string[],
  when?: CommandDefinition["when"],
): CommandDefinition => ({
  id,
  title: id,
  category: "File",
  keys: { default: keys },
  when,
});

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Setup {
  commands: CommandDefinition[];
  handlers: Record<string, CommandHandler>;
  options?: Partial<KeyOptions>;
  overrides?: Record<string, string[]>;
}
const install = ({ commands, handlers, options, overrides = {} }: Setup) => {
  const opts: KeyOptions = {
    leader: "Space",
    timeoutMs: 1000,
    cancelAfterMs: 5000,
    ...options,
  };
  const keymap = buildKeymap(commands, overrides, "mac");
  const seqRoot = buildKeyTrie(commands, overrides, opts, "mac");
  dispose = installCommandDispatcher(window, {
    platform: "mac",
    getKeymap: () => keymap,
    getSeqRoot: () => seqRoot,
    getOptions: () => opts,
    getContext: () => readContext(document, app),
    getHandler: (id) => handlers[id],
  });
};

const press = (
  init: KeyboardEventInit,
  target: EventTarget = document.body,
) => {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};
const letter = (c: string, init: KeyboardEventInit = {}) =>
  press({ code: `Key${c.toUpperCase()}`, key: c, ...init });
const escape = () => press({ code: "Escape", key: "Escape" });
const backspace = () => press({ code: "Backspace", key: "Backspace" });
const space = () => press({ code: "Space", key: " " });

const canvas = () => {
  document.body.innerHTML =
    '<div class="vault-editor"><button id="c"></button></div>';
  (document.getElementById("c") as HTMLElement).focus();
  return document.getElementById("c") as HTMLElement;
};
const input = () => {
  document.body.innerHTML = '<div class="vault-editor"><input id="t"></div>';
  (document.getElementById("t") as HTMLElement).focus();
  return document.getElementById("t") as HTMLElement;
};

describe("dispatcher key sequences", () => {
  it("runs g g, claims both keys, leaves other keys alone", () => {
    const first = vi.fn();
    install({
      commands: [cmd("a.first", ["g g"])],
      handlers: { "a.first": first },
    });
    const doc = vi.fn();
    document.addEventListener("keydown", doc);
    const t = canvas();
    const e1 = letter("g", {}) as KeyboardEvent;
    expect(e1.defaultPrevented).toBe(true);
    expect(getPendingKeys()).toEqual(["G"]);
    expect(first).not.toHaveBeenCalled();
    const e2 = letter("g");
    expect(e2.defaultPrevented).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(getPendingKeys()).toEqual([]);
    expect(doc).not.toHaveBeenCalled();
    // idle again: unbound key untouched
    expect(letter("x", {}).defaultPrevented).toBe(false);
    expect(t).toBeTruthy();
    document.removeEventListener("keydown", doc);
  });

  it("expands <leader> and runs Vim-style aliases", () => {
    const files = vi.fn();
    const save = vi.fn();
    install({
      commands: [
        cmd("a.files", ["<leader> f f"]),
        cmd("a.save", ["<C-x> <C-s>"]),
      ],
      handlers: { "a.files": files, "a.save": save },
    });
    canvas();
    space();
    letter("f");
    expect(getPendingKeys()).toEqual(["Space", "F"]);
    letter("f");
    expect(files).toHaveBeenCalledTimes(1);
    press({ code: "KeyX", key: "x", ctrlKey: true });
    press({ code: "KeyS", key: "s", ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("runs Mod+Alt+K Mod+S", () => {
    const h = vi.fn();
    install({
      commands: [cmd("a.x", ["Mod+Alt+K Mod+S"])],
      handlers: { "a.x": h },
    });
    canvas();
    press({ code: "KeyK", key: "k", metaKey: true, altKey: true });
    press({ code: "KeyS", key: "s", metaKey: true });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels (swallowed); Backspace goes up one level", () => {
    const h = vi.fn();
    install({ commands: [cmd("a.x", ["g f g"])], handlers: { "a.x": h } });
    canvas();
    letter("g");
    letter("f");
    expect(getPendingKeys()).toEqual(["G", "F"]);
    expect(backspace().defaultPrevented).toBe(true);
    expect(getPendingKeys()).toEqual(["G"]);
    letter("f");
    letter("g");
    expect(h).toHaveBeenCalledTimes(1);
    letter("g");
    expect(escape().defaultPrevented).toBe(true);
    expect(getPendingKeys()).toEqual([]);
    // Escape when idle is not claimed
    expect(escape().defaultPrevented).toBe(false);
    letter("g");
    expect(backspace().defaultPrevented).toBe(true); // up from level 1 = cancel
    expect(getPendingKeys()).toEqual([]);
  });

  it("swallows a mismatch on the canvas, passes it in text editing", () => {
    const h = vi.fn();
    install({ commands: [cmd("a.x", ["Mod+K g"])], handlers: { "a.x": h } });
    canvas();
    press({ code: "KeyK", key: "k", metaKey: true });
    expect(letter("z").defaultPrevented).toBe(true);
    expect(getPendingKeys()).toEqual([]);

    const t = input();
    expect(
      press({ code: "KeyK", key: "k", metaKey: true }, t).defaultPrevented,
    ).toBe(true);
    expect(letter("z", {}).defaultPrevented).toBe(false);
    expect(getPendingKeys()).toEqual([]);
  });

  it("starts in text only with Mod/Ctrl/Alt, never with a plain key or AltGr", () => {
    const h = vi.fn();
    install({
      commands: [cmd("a.x", ["g g"]), cmd("a.y", ["Ctrl+Alt+Q Mod+S"])],
      handlers: { "a.x": h, "a.y": h },
    });
    const t = input();
    expect(letter("g", {}).defaultPrevented).toBe(false);
    expect(getPendingKeys()).toEqual([]);
    expect(
      press({ code: "KeyQ", key: "@", ctrlKey: true, altKey: true }, t)
        .defaultPrevented,
    ).toBe(false);
    expect(getPendingKeys()).toEqual([]);
  });

  it("ignores key repeat while pending", () => {
    const h = vi.fn();
    install({ commands: [cmd("a.x", ["g g"])], handlers: { "a.x": h } });
    canvas();
    letter("g");
    const r = letter("g", { repeat: true });
    expect(r.defaultPrevented).toBe(true);
    expect(h).not.toHaveBeenCalled();
    expect(getPendingKeys()).toEqual(["G"]);
  });

  it("falls through to the single chord when no descendant is live", () => {
    const single = vi.fn();
    install({
      commands: [
        cmd("a.single", ["g"]),
        cmd("a.seq", ["g g"], ["!drawingOpen"]),
        cmd("a.nohandler", ["g h"]),
      ],
      handlers: { "a.single": single },
    });
    canvas();
    const e = letter("g");
    expect(e.defaultPrevented).toBe(true);
    expect(single).toHaveBeenCalledTimes(1);
    expect(getPendingKeys()).toEqual([]);
  });

  it("does not claim a sequence start with no live path and no single chord", () => {
    install({
      commands: [cmd("a.seq", ["g g"], ["!drawingOpen"])],
      handlers: { "a.seq": vi.fn() },
    });
    canvas();
    expect(letter("g").defaultPrevented).toBe(false);
  });

  it("ambiguity: runs the shorter binding after timeout_ms, longer if a key follows", () => {
    vi.useFakeTimers();
    const short = vi.fn();
    const long = vi.fn();
    install({
      commands: [cmd("a.short", ["g g"]), cmd("a.long", ["g g g"])],
      handlers: { "a.short": short, "a.long": long },
    });
    canvas();
    letter("g");
    letter("g");
    expect(short).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(short).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(short).toHaveBeenCalledTimes(1);
    expect(getPendingKeys()).toEqual([]);

    letter("g");
    letter("g");
    vi.advanceTimersByTime(500);
    letter("g");
    expect(long).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(short).toHaveBeenCalledTimes(1);
  });

  it("timeout_ms = 0 waits for a key", () => {
    vi.useFakeTimers();
    const short = vi.fn();
    install({
      commands: [cmd("a.short", ["g g"]), cmd("a.long", ["g g g"])],
      handlers: { "a.short": short, "a.long": vi.fn() },
      options: { timeoutMs: 0, cancelAfterMs: 0 },
    });
    canvas();
    letter("g");
    letter("g");
    vi.advanceTimersByTime(60_000);
    expect(short).not.toHaveBeenCalled();
    expect(getPendingKeys()).toEqual(["G", "G"]);
  });

  it("cancel_after_ms drops a half-typed sequence; 0 never does", () => {
    vi.useFakeTimers();
    install({
      commands: [cmd("a.x", ["g g"])],
      handlers: { "a.x": vi.fn() },
      options: { cancelAfterMs: 2000 },
    });
    canvas();
    letter("g");
    vi.advanceTimersByTime(1999);
    expect(getPendingKeys()).toEqual(["G"]);
    vi.advanceTimersByTime(2);
    expect(getPendingKeys()).toEqual([]);
  });

  it("cancels on window blur, pointerdown, IME, focusin, reload and pause", () => {
    const h = vi.fn();
    install({ commands: [cmd("a.x", ["g g"])], handlers: { "a.x": h } });
    const t = canvas();
    const start = () => {
      letter("g");
      expect(getPendingKeys()).toEqual(["G"]);
    };
    start();
    t.dispatchEvent(new Event("blur")); // element blur: ignored
    expect(getPendingKeys()).toEqual(["G"]);
    window.dispatchEvent(new Event("blur"));
    expect(getPendingKeys()).toEqual([]);
    start();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(getPendingKeys()).toEqual([]);
    start();
    document.body.dispatchEvent(
      new Event("compositionstart", { bubbles: true }),
    );
    expect(getPendingKeys()).toEqual([]);
    start();
    t.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(getPendingKeys()).toEqual([]);
    start();
    cancelPendingSequence();
    expect(getPendingKeys()).toEqual([]);
    start();
    const resume = pauseDispatcher();
    letter("g");
    resume();
    expect(getPendingKeys()).toEqual([]);
    letter("g");
    letter("g");
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("respects the command's when at the end of the path", () => {
    const h = vi.fn();
    install({
      commands: [cmd("a.x", ["g g"], ["canvasFocus"])],
      handlers: { "a.x": h },
    });
    canvas();
    letter("g");
    document.body.innerHTML = '<button id="o"></button>';
    (document.getElementById("o") as HTMLElement).focus();
    letter("g"); // when no longer holds: ends without running
    expect(h).not.toHaveBeenCalled();
    expect(getPendingKeys()).toEqual([]);
  });

  it("user overrides move a sequence", () => {
    const h = vi.fn();
    install({
      commands: [cmd("a.x", ["g g"])],
      handlers: { "a.x": h },
      overrides: { "a.x": ["z z"] },
    });
    canvas();
    expect(letter("g").defaultPrevented).toBe(false);
    letter("z");
    letter("z");
    expect(h).toHaveBeenCalledTimes(1);
  });
});

describe("dispatcher idle cost with no sequences", () => {
  it("creates no timer or extra listener, and unbound keys pass", () => {
    const st = vi.spyOn(globalThis, "setTimeout");
    const add = vi.spyOn(window, "addEventListener");
    const h = vi.fn();
    const commands = [cmd("a.x", ["Mod+S"])];
    const keymap = buildKeymap(commands, {}, "mac");
    expect(buildKeyTrie(commands, {}, { leader: "Space" }, "mac")).toBeNull();
    dispose = installCommandDispatcher(window, {
      platform: "mac",
      getKeymap: () => keymap,
      getContext: () => readContext(document, app),
      getHandler: () => h,
    });
    expect(add).toHaveBeenCalledTimes(1); // the keydown listener only
    expect(letter("g", {}).defaultPrevented).toBe(false);
    press({ code: "KeyS", key: "s", metaKey: true });
    expect(h).toHaveBeenCalledTimes(1);
    expect(st).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("adds cancel listeners only while pending and removes them after", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    install({ commands: [cmd("a.x", ["g g"])], handlers: { "a.x": vi.fn() } });
    canvas();
    const base = add.mock.calls.length;
    letter("g");
    expect(add.mock.calls.length).toBe(base + 4);
    const removedBefore = remove.mock.calls.length;
    letter("g");
    expect(remove.mock.calls.length).toBe(removedBefore + 4);
  });
});
