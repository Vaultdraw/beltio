import { newElement, newTextElement } from "@excalidraw/element";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createResolver } from "../../links/resolve";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { applyEdits, setElementLinks } from "./applyEdits";
import { assignLabels, collectHintTargets, LinkHints } from "./linkHints";
import { ModifierLinks } from "./modifierLinks";
import { createLinkOpener, createOnLinkOpen, targetOf } from "./onLinkOpen";
import { remeasureElements } from "./remeasure";
import { findOpenLink, insertLink, WikiAutocomplete } from "./wikiAutocomplete";

import type { LinksSettings } from "../../links/types";

const NAMES = [
  "Graphs/BFS and DFS.excalidraw",
  "Graphs/Dijkstra.excalidraw",
  "Notes.excalidraw",
  "School/Notes.excalidraw",
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("onLinkOpen", () => {
  const setup = () => {
    const cb = { openDrawing: vi.fn(), onUnresolved: vi.fn() };
    const openRaw = createLinkOpener({
      getFromPath: () => "a.excalidraw",
      getResolver: () => createResolver(NAMES),
      getCallbacks: () => cb,
    });
    return { cb, handler: createOnLinkOpen(openRaw) };
  };
  const event = () => ({ preventDefault: vi.fn() });

  it("opens vault links in every accepted form and prevents the default", () => {
    const { cb, handler } = setup();
    for (const link of [
      "[[Dijkstra]]",
      "vaultdraw://open?file=Graphs/Dijkstra",
      "Graphs/Dijkstra.excalidraw",
    ]) {
      const ev = event();
      handler({ link }, ev);
      expect(ev.preventDefault).toHaveBeenCalled();
    }
    expect(cb.openDrawing).toHaveBeenCalledTimes(3);
    expect(cb.openDrawing).toHaveBeenCalledWith(
      "Graphs/Dijkstra.excalidraw",
      undefined,
      "current",
    );
  });

  it("reports unresolved targets and never lets '/' links navigate", () => {
    const { cb, handler } = setup();
    const ev = event();
    handler({ link: "[[Nothing here]]" }, ev);
    expect(cb.onUnresolved).toHaveBeenCalledWith("Nothing here");
    const slash = event();
    handler({ link: "/some/page" }, slash);
    expect(slash.preventDefault).toHaveBeenCalled();
    expect(cb.openDrawing).not.toHaveBeenCalled();
  });

  it("sends web links to the default browser, not the webview's window.open", () => {
    const { cb } = setup();
    const openWeb = vi.fn();
    const handler = createOnLinkOpen(() => false, openWeb);
    const ev = event();
    handler({ link: "https://example.com" }, ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(openWeb).toHaveBeenCalledWith("https://example.com");
    const none = event();
    handler({ link: null }, none);
    expect(none.preventDefault).not.toHaveBeenCalled();
    expect(cb.openDrawing).not.toHaveBeenCalled();
    expect(targetOf("https://x")).toBeNull();
  });

  it("asks the fallback when the names list does not know the target", async () => {
    const cb = { openDrawing: vi.fn(), onUnresolved: vi.fn() };
    const openRaw = createLinkOpener({
      getFromPath: () => null,
      getResolver: () => createResolver([]),
      getCallbacks: () => cb,
      fallbackResolve: async () => ({
        path: "Late.excalidraw",
        candidates: [],
      }),
    });
    expect(openRaw("[[Late]]")).toBe(true);
    await vi.waitFor(() =>
      expect(cb.openDrawing).toHaveBeenCalledWith(
        "Late.excalidraw",
        undefined,
        "current",
      ),
    );
  });
});

describe("findOpenLink", () => {
  const find = (s: string) => findOpenLink(s, s.length);
  it("finds the open [[ before the caret", () => {
    expect(find("see [[BF")).toEqual({ start: 4, query: "BF", inLabel: false });
    expect(find("[[")).toEqual({ start: 0, query: "", inLabel: false });
    expect(find("a [[b]] c [[d e")).toMatchObject({ start: 10, query: "d e" });
  });
  it("is null without an open link", () => {
    expect(find("plain text")).toBeNull();
    expect(find("[[done]] and more")).toBeNull();
    expect(find("[[a\nb")).toBeNull();
    expect(find("[ [x")).toBeNull();
    expect(find("")).toBeNull();
  });
  it("reports the label part after a pipe", () => {
    expect(find("[[Name|lab")).toEqual({
      start: 0,
      query: "Name",
      inLabel: true,
    });
  });
  it("does not scan beyond the link length cap", () => {
    expect(find(`[[${"x".repeat(400)}`)).toBeNull();
  });
  it("inserts, consuming a closing ]] that is already there", () => {
    const open = { start: 4, query: "BF", inLabel: false };
    expect(insertLink("see [[BF", 8, open, "BFS")).toEqual({
      value: "see [[BFS]]",
      caret: 11,
    });
    expect(insertLink("see [[BF]] now", 8, open, "BFS")).toEqual({
      value: "see [[BFS]] now",
      caret: 11,
    });
  });
});

describe("WikiAutocomplete", () => {
  async function setup(settings: Partial<LinksSettings> = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onCreate = vi.fn();
    const full = { ...DEFAULT_LINKS_SETTINGS, ...settings };
    const ac = new WikiAutocomplete({
      container,
      getNames: () => NAMES,
      getResolver: () => createResolver(NAMES),
      getSettings: () => full,
      getCurrentPath: () => "a.excalidraw",
      onCreate,
    });
    ac.start();
    const wrap = document.createElement("div");
    const ta = document.createElement("textarea");
    ta.className = "excalidraw-wysiwyg";
    wrap.appendChild(ta);
    container.appendChild(wrap);
    const onInput = vi.fn();
    ta.addEventListener("input", onInput);
    const type = (value: string, caret = value.length) => {
      ta.value = value;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const key = (k: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      ta.dispatchEvent(e);
      return e;
    };
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver attaches
    return { ac, ta, type, key, onCreate, onInput, container };
  }

  it("does nothing for text without an open [[", async () => {
    const { ac, type } = await setup();
    type("hello world");
    expect(ac.state).toBeNull();
  });

  it("shows ranked names with a create row and inserts the shortest target", async () => {
    const { ac, ta, type, key } = await setup();
    type("see [[dij");
    expect(ac.state?.rows.map((r) => r.path)).toEqual([
      "Graphs/Dijkstra.excalidraw",
    ]);
    expect(ac.state?.create).toBe("dij");
    const down = key("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(ac.state?.selected).toBe(1);
    key("ArrowUp");
    expect(ac.state?.selected).toBe(0);
    const enter = key("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(ta.value).toBe("see [[Dijkstra]]");
    expect(ta.selectionStart).toBe(16);
    expect(ac.state).toBeNull();
  });

  it("ranks 'notes' ambiguity into a path target", async () => {
    const { ac, ta, type, key } = await setup();
    type("[[school");
    expect(ac.state?.rows[0].target).toBe("School/Notes");
    key("Tab");
    expect(ta.value).toBe("[[School/Notes]]");
  });

  it("supports Ctrl+N / Ctrl+P and Escape closes only the popup", async () => {
    const { ac, type, key } = await setup();
    type("[[Notes");
    const before = ac.state!.selected;
    expect(key("n", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ac.state!.selected).not.toBe(before);
    expect(key("p", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(ac.state).toBeNull();
    // closed: keys pass through untouched
    expect(key("Enter").defaultPrevented).toBe(false);
  });

  it("the create row calls onCreate and inserts the typed name", async () => {
    const { ac, ta, type, key, onCreate } = await setup();
    type("[[Brand new");
    expect(ac.state?.rows).toEqual([]);
    key("Enter");
    expect(onCreate).toHaveBeenCalledWith("Brand new");
    expect(ta.value).toBe("[[Brand new]]");
  });

  it("typing | starts a label and closes the popup", async () => {
    const { ac, type } = await setup();
    type("[[Dij");
    expect(ac.state).not.toBeNull();
    type("[[Dijkstra|");
    expect(ac.state).toBeNull();
  });

  it("claims keys only while open", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { ac, type } = await setup();
    type("plain");
    const keydowns = () =>
      add.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(keydowns()).toBe(0);
    type("[[Not");
    expect(keydowns()).toBe(1);
    ac.close();
    expect(remove.mock.calls.filter((c) => c[0] === "keydown")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("is inert when the setting is off, and stops observing", async () => {
    const { ac, type } = await setup({ autocomplete: false });
    type("[[Dij");
    expect(ac.state).toBeNull();
  });

  it("does not take focus and ignores IME composition", async () => {
    const { ac, ta, type } = await setup();
    type("[[Dij");
    ta.focus();
    const e = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(ac.state).not.toBeNull();
  });
});

type Box = Record<string, unknown>;
function fakeApi(
  elements: Box[],
  state: Partial<Record<string, unknown>> = {},
) {
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      width: 1000,
      height: 800,
      selectedElementIds: {},
      ...state,
    }),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
}

describe("ModifierLinks", () => {
  const sceneWithLink = () => {
    const text = newTextElement({ text: "go [[Dijkstra]] now", x: 0, y: 0 });
    return [text] as unknown as Box[];
  };

  it("attaches pointer listeners only while the modifier is held", () => {
    const container = document.createElement("div");
    const add = vi.spyOn(container, "addEventListener");
    const remove = vi.spyOn(container, "removeEventListener");
    const ml = new ModifierLinks({
      container,
      getApi: () => fakeApi([]).api,
      getModifier: () => "alt",
      openRaw: () => true,
    });
    ml.start();
    // Idle: only the (middle-click) pointerdown listener.
    expect(add.mock.calls.map((c) => c[0])).toEqual(["pointerdown"]);
    add.mockClear();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(ml.isArmed).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    expect(ml.isArmed).toBe(true);
    expect(add.mock.calls.map((c) => c[0])).toEqual(["pointermove"]);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(ml.isArmed).toBe(false);
    expect(remove.mock.calls.map((c) => c[0])).toEqual(["pointermove"]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    window.dispatchEvent(new Event("blur"));
    expect(ml.isArmed).toBe(false);
    ml.stop();
  });

  it("opens the link under the pointer on modifier+click and swallows the event", () => {
    const container = document.createElement("div");
    const openRaw = vi.fn(() => true);
    const els = sceneWithLink();
    const ml = new ModifierLinks({
      container,
      getApi: () => fakeApi(els).api,
      getModifier: () => "alt",
      openRaw,
    });
    ml.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    // The text starts at x=0; with the canvas mock each char is 10px wide.
    const w = (els[0] as { width: number }).width;
    const down = (x: number) => {
      const e = new MouseEvent("pointerdown", {
        clientX: x,
        clientY: 5,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      container.dispatchEvent(e);
      return e;
    };
    expect(w).toBeGreaterThan(0);
    const miss = down(w + 500);
    expect(miss.defaultPrevented).toBe(false);
    expect(openRaw).not.toHaveBeenCalled();
    // Aim at the middle of the link span "[[Dijkstra]]" in the measured text.
    const hit = down((w * 8) / 19);
    expect(hit.defaultPrevented).toBe(true);
    expect(openRaw).toHaveBeenCalledWith("[[Dijkstra]]", { target: "current" });
    ml.stop();
  });

  it("opens a linked shape on modifier+click", () => {
    const container = document.createElement("div");
    const openRaw = vi.fn(() => true);
    const rect = newElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      link: "[[Dijkstra]]",
    });
    const ml = new ModifierLinks({
      container,
      getApi: () => fakeApi([rect as unknown as Box]).api,
      getModifier: () => "alt",
      openRaw,
    });
    ml.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    container.dispatchEvent(
      new MouseEvent("pointerdown", {
        clientX: 20,
        clientY: 20,
        altKey: true,
        bubbles: true,
      }),
    );
    expect(openRaw).toHaveBeenCalledWith("[[Dijkstra]]", { target: "current" });
    ml.stop();
  });
});

describe("link hints", () => {
  it("assigns uniform, prefix-free labels", () => {
    expect(assignLabels(3, "asdf")).toEqual(["a", "s", "d"]);
    const two = assignLabels(6, "asd");
    expect(new Set(two.map((l) => l.length))).toEqual(new Set([2]));
    expect(new Set(two).size).toBe(6);
    for (const a of two) {
      for (const b of two) {
        if (a !== b) {
          expect(b.startsWith(a)).toBe(false);
        }
      }
    }
    expect(assignLabels(2, "")).toEqual(["a", "s"]);
    expect(assignLabels(2, "aab")).toEqual(["a", "b"]);
  });

  const scene = () => {
    const text = newTextElement({ text: "[[A]] and [[B|b]]", x: 0, y: 100 });
    const shape = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      link: "vaultdraw://open?file=C",
    });
    const web = newElement({
      type: "rectangle",
      x: 0,
      y: 300,
      width: 50,
      height: 50,
      link: "https://example.com",
    });
    const far = newElement({
      type: "rectangle",
      x: 50000,
      y: 0,
      width: 50,
      height: 50,
      link: "[[Far]]",
    });
    return [text, shape, web, far] as unknown as Box[];
  };

  it("collects only visible vault links, in reading order", () => {
    const { api } = fakeApi(scene());
    const targets = collectHintTargets(
      api.getSceneElements() as never,
      api.getAppState() as never,
    );
    expect(targets.map((t) => t.raw)).toEqual([
      "vaultdraw://open?file=C",
      "[[A]]",
      "[[B]]",
    ]);
  });

  it("opens the typed hint, cancels on other keys and Escape", () => {
    const { api } = fakeApi(scene());
    const openRaw = vi.fn(() => true);
    const hints = new LinkHints({
      getApi: () => api,
      getHintChars: () => "ab",
      openRaw,
    });
    expect(hints.start()).toBe(true);
    const press = (key: string, init: KeyboardEventInit = {}) =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    // 3 hints with alphabet "ab" -> two letters each
    const labels = hints.state!.hints.map((h) => h.label);
    expect(labels.every((l) => l.length === 2)).toBe(true);
    press("a");
    expect(hints.state?.typed).toBe("a");
    press(labels[0][1]);
    expect(openRaw).toHaveBeenCalledWith(
      hints.state ? "" : "vaultdraw://open?file=C",
      { target: "current" },
    );
    expect(hints.active).toBe(false);

    hints.start();
    press("Escape");
    expect(hints.active).toBe(false);
    hints.start();
    press("z");
    expect(hints.active).toBe(false);
    hints.start();
    press("Shift");
    expect(hints.active).toBe(true);
    press("k", { metaKey: true });
    expect(hints.active).toBe(false);
  });

  it("does not start (and attaches nothing) without visible links", () => {
    const add = vi.spyOn(document, "addEventListener");
    const hints = new LinkHints({
      getApi: () => fakeApi([]).api,
      getHintChars: () => "ab",
      openRaw: () => true,
    });
    expect(hints.start()).toBe(false);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });
});

describe("applyEdits / remeasure", () => {
  it("applies text edits undoably with fresh dimensions in one update", () => {
    const text = newTextElement({ text: "see [[Old]]", x: 0, y: 0 });
    const { api, updateScene } = fakeApi([text as unknown as Box]);
    const next = "see [[A much longer drawing name]]";
    expect(
      applyEdits(api, [{ elementId: text.id, field: "text", value: next }]),
    ).toBe(1);
    const call = updateScene.mock.calls[0][0];
    expect(call.captureUpdate).toBe("IMMEDIATELY");
    const el = call.elements[0];
    expect(el.text).toBe(next);
    expect(el.originalText).toBe(next);
    expect(el.width).toBeGreaterThan(text.width);
    expect(el.version).toBeGreaterThan(text.version);
  });

  it("sets and clears links, and ignores unknown or deleted elements", () => {
    const rect = newElement({ type: "rectangle", x: 0, y: 0 });
    const gone = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      isDeleted: true,
    };
    const { api, updateScene } = fakeApi([rect, gone] as unknown as Box[]);
    expect(setElementLinks(api, [rect.id, gone.id, "nope"], "[[X]]")).toBe(1);
    expect(updateScene.mock.calls[0][0].elements[0].link).toBe("[[X]]");
    expect(
      applyEdits(api, [{ elementId: "nope", field: "link", value: "" }]),
    ).toBe(0);
    expect(applyEdits(api, [])).toBe(0);
    setElementLinks(api, [rect.id], null);
    expect(updateScene.mock.calls[1][0].elements[0].link).toBeNull();
  });

  it("re-measures only the given text elements, without an undo entry", async () => {
    const a = newTextElement({ text: "[[Short]]", x: 0, y: 0 });
    const stale = {
      ...a,
      id: "stale",
      originalText: "[[A rather long replacement]]",
      text: "[[A rather long replacement]]",
      width: 10,
    };
    const other = {
      ...newTextElement({ text: "keep", x: 0, y: 50 }),
      width: 7,
    };
    const { api, updateScene } = fakeApi([stale, other] as unknown as Box[]);
    expect(await remeasureElements(api, ["stale"])).toBe(1);
    const call = updateScene.mock.calls[0][0];
    expect(call.captureUpdate).toBe("NEVER");
    expect(call.elements[0].width).toBeGreaterThan(10);
    expect(call.elements[1].width).toBe(7);
    expect(await remeasureElements(api, [])).toBe(0);
    expect(await remeasureElements(api, ["missing"])).toBe(0);
  });
});
