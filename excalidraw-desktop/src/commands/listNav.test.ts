import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_COMMANDS } from "./commands";
import { findConflicts } from "./conflicts";
import { readContext } from "./context";
import { getRegisteredHandler } from "./handlerRegistry";
import { LIST_COMMANDS } from "./listCommands";
import { installListKeysForTests, pressListKey } from "./listKeysForTests";
import { focusList, registerList } from "./listNav";

const APP = { vaultOpen: true, drawingOpen: true, writable: true };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  document.body.innerHTML = "";
});

const mount = (html = `<div tabindex="0"><button>row</button></div>`) => {
  document.body.insertAdjacentHTML("beforeend", html);
  return document.body.lastElementChild as HTMLElement;
};

describe("listNav", () => {
  it("binds no handlers until a list registers", () => {
    expect(getRegisteredHandler("list.down")).toBeUndefined();
    const el = mount();
    cleanups.push(registerList(el, "test", { down: () => {} }));
    expect(getRegisteredHandler("list.down")).toBeDefined();
  });

  it("offers only the actions the target list implements", () => {
    const el = mount();
    cleanups.push(registerList(el, "test", { down: () => {} }));
    expect(getRegisteredHandler("list.down")).toBeDefined();
    expect(getRegisteredHandler("list.rename")).toBeUndefined();
  });

  it("listFocus holds in a list, not in its text fields or elsewhere", () => {
    const el = mount(`<div tabindex="0"><input type="text" /></div>`);
    const outside = mount(`<button>x</button>`);
    cleanups.push(registerList(el, "test", {}));
    el.focus();
    expect(readContext(document, APP).listFocus).toBe(true);
    el.querySelector("input")!.focus();
    expect(readContext(document, APP).listFocus).toBe(false);
    outside.focus();
    expect(readContext(document, APP).listFocus).toBe(false);
  });

  it("runs on the focused list; a palette run focuses the last one used", () => {
    const a = mount();
    const b = mount();
    const downA = vi.fn();
    const downB = vi.fn();
    cleanups.push(registerList(a, "a", { down: downA }));
    cleanups.push(registerList(b, "b", { down: downB }));
    a.focus();
    getRegisteredHandler("list.down")!();
    expect(downA).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement).blur();
    getRegisteredHandler("list.down")!();
    expect(downA).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(a);
    expect(downB).not.toHaveBeenCalled();
  });

  it("keys run list commands only while a list has focus", () => {
    cleanups.push(installListKeysForTests());
    const el = mount();
    const outside = mount(`<button>x</button>`);
    const down = vi.fn();
    cleanups.push(registerList(el, "test", { down }));
    pressListKey(el, "j");
    pressListKey(el, "ArrowDown");
    expect(down).toHaveBeenCalledTimes(2);
    outside.focus();
    outside.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("an action the list lacks leaves the key to the page", () => {
    cleanups.push(installListKeysForTests());
    const el = mount();
    cleanups.push(registerList(el, "test", { down: () => {} }));
    el.focus();
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("unregistering removes the attribute and, last, the handlers", () => {
    const el = mount();
    const off = registerList(el, "test", { down: () => {} });
    expect(el.getAttribute("data-keylist")).toBe("test");
    off();
    expect(el.hasAttribute("data-keylist")).toBe(false);
    expect(getRegisteredHandler("list.down")).toBeUndefined();
  });

  it("focusList focuses a list by name", () => {
    const el = mount();
    cleanups.push(registerList(el, "tree", {}));
    expect(focusList("nope")).toBe(false);
    expect(focusList("tree")).toBe(true);
    expect(document.activeElement).toBe(el);
  });
});

describe("list commands", () => {
  it.each(["mac", "win", "linux"] as const)(
    "collide with no other command on %s",
    (platform) => {
      const ids = new Set(LIST_COMMANDS.map((c) => c.id));
      const bad = [...findConflicts(BUILTIN_COMMANDS, {}, platform)]
        .filter(([id]) => ids.has(id))
        .flatMap(([id, perChord]) =>
          [...perChord].flatMap(([chord, found]) =>
            found
              .filter((f) => f.kind !== "excalidraw")
              .map((f) => `${id} ${chord} ~ ${JSON.stringify(f)}`),
          ),
        );
      expect(bad).toEqual([]);
    },
  );

  it("are all listed in the palette under Navigator", () => {
    for (const c of LIST_COMMANDS) {
      expect(c.palette).not.toBe(false);
      expect(c.category).toBe("Navigator");
    }
  });
});
