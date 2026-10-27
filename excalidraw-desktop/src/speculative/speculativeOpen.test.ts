import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadScene } from "../editor/sceneSwap";

import { installPointerPrefetch, pathOfTarget } from "./pointerPrefetch";
import {
  SPECULATIVE_PARSE_MAX_CHARS,
  SPECULATIVE_TTL_MS,
  discardSpeculativeOpen,
  hasSpeculativeOpen,
  startSpeculativeOpen,
  takeSpeculativeRead,
  takeSpeculativeScene,
} from "./speculativeOpen";

const source = (color = "#a5d8ff") =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: color },
    files: {},
  });

const file = (json: string) => ({ json, revision: "r1" });
const flush = async () => {
  await vi.advanceTimersByTimeAsync(5);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  discardSpeculativeOpen();
  vi.useRealTimers();
});

describe("speculative open slot", () => {
  it("hands the read to its own open once, and the parse to the same text once", async () => {
    const json = source();
    startSpeculativeOpen("h", "a.excalidraw", async () => file(json));
    expect(await takeSpeculativeRead("h", "a.excalidraw")).toEqual(file(json));
    expect(takeSpeculativeRead("h", "a.excalidraw")).toBeNull();
    const scene = takeSpeculativeScene(json);
    await flush();
    const raw = await scene;
    expect(raw?.appState.viewBackgroundColor).toBe("#a5d8ff");
    expect(await takeSpeculativeScene(json)).toBeNull();
    expect(hasSpeculativeOpen()).toBe(false);
  });

  it("never hands out another path, another vault or different text", async () => {
    const json = source();
    startSpeculativeOpen("h", "a.excalidraw", async () => file(json));
    expect(takeSpeculativeRead("h", "b.excalidraw")).toBeNull();
    expect(takeSpeculativeRead("other", "a.excalidraw")).toBeNull();
    await takeSpeculativeRead("h", "a.excalidraw");
    const scene = takeSpeculativeScene(source("#ffffff"));
    await flush();
    expect(await scene).toBeNull();
  });

  it("holds one entry: a new press replaces the old one and stops its parse", async () => {
    const parsedSources: string[] = [];
    const read = (_h: string, p: string) => {
      parsedSources.push(p);
      return Promise.resolve(file(source(p === "a" ? "#111111" : "#222222")));
    };
    startSpeculativeOpen("h", "a", read);
    startSpeculativeOpen("h", "b", read); // before a's parse task ran
    expect(takeSpeculativeRead("h", "a")).toBeNull();
    await takeSpeculativeRead("h", "b");
    const scene = takeSpeculativeScene(source("#222222"));
    await flush();
    expect((await scene)?.appState.viewBackgroundColor).toBe("#222222");
  });

  it("lets an unclaimed entry expire and releases it", async () => {
    startSpeculativeOpen("h", "a", async () => file(source()));
    expect(hasSpeculativeOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(SPECULATIVE_TTL_MS + 1);
    expect(hasSpeculativeOpen()).toBe(false);
    expect(takeSpeculativeRead("h", "a")).toBeNull();
  });

  it("reads a huge file ahead but does not parse it", async () => {
    const json = source() + " ".repeat(SPECULATIVE_PARSE_MAX_CHARS);
    startSpeculativeOpen("h", "a", async () => file(json));
    await takeSpeculativeRead("h", "a");
    const scene = takeSpeculativeScene(json);
    await flush();
    expect(await scene).toBeNull();
  });

  it("a failed read or a broken file leaves the normal open to report it", async () => {
    startSpeculativeOpen("h", "a", () => Promise.reject(new Error("io")));
    await expect(takeSpeculativeRead("h", "a")).rejects.toThrow("io");
    const bad = "{ nope";
    startSpeculativeOpen("h", "b", async () => file(bad));
    await takeSpeculativeRead("h", "b");
    const scene = takeSpeculativeScene(bad);
    await flush();
    expect(await scene).toBeNull();
  });

  it("loadScene uses the parse that was started ahead, with the tab's view", async () => {
    const json = source("#b2f2bb");
    startSpeculativeOpen("h", "a", async () => file(json));
    await takeSpeculativeRead("h", "a");
    const loading = loadScene(json, { scrollX: 3, scrollY: 4, zoom: 2 });
    await flush();
    const scene = await loading;
    expect(scene.appState.viewBackgroundColor).toBe("#b2f2bb");
    expect(scene.appState.scrollX).toBe(3);
    expect(hasSpeculativeOpen()).toBe(false);
  });

  it("loadScene parses by itself when nothing was started", async () => {
    const loading = loadScene(source("#ffc9c9"), undefined);
    await flush();
    expect((await loading).appState.viewBackgroundColor).toBe("#ffc9c9");
  });
});

/** jsdom has no PointerEvent: a mouse event of the pointer type, flagged primary. */
const pointerEvent = (
  type: string,
  init: MouseEventInit & { isPrimary?: boolean } = {},
) => {
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, "isPrimary", { value: init.isPrimary ?? true });
  return event;
};

describe("pointer prefetch", () => {
  let cleanup: (() => void) | null = null;
  const reads: string[] = [];
  const press = (el: Element, x = 0, y = 0) =>
    el.dispatchEvent(
      pointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        clientX: x,
        clientY: y,
      }),
    );
  const setup = (active: string | null = null, handle: string | null = "h") => {
    document.body.innerHTML = `
      <div class="vault-tree-item" data-tree-kind="drawing" data-tree-path="a.excalidraw"><span id="name">a</span></div>
      <div class="vault-tree-item" data-tree-kind="folder" data-tree-path="dir"></div>
      <div class="vault-tabs__tab" data-path="tab.excalidraw" id="tab"></div>
      <div class="vault-tabs__tab" data-path="" id="untitled"></div>
      <div class="vault-quick__row" data-open-path="sw.excalidraw" id="sw"></div>`;
    cleanup = installPointerPrefetch(document, {
      handle: () => handle,
      activePath: () => active,
      read: (_h, p) => {
        reads.push(p);
        return Promise.resolve(file(source()));
      },
    });
  };
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    reads.length = 0;
  });

  it("finds the path on a tree drawing row, a tab and a switcher row only", () => {
    setup();
    const q = (s: string) => document.querySelector(s);
    expect(pathOfTarget(q("#name"))).toBe("a.excalidraw");
    expect(pathOfTarget(q("[data-tree-kind=folder]"))).toBeNull();
    expect(pathOfTarget(q("#tab"))).toBe("tab.excalidraw");
    expect(pathOfTarget(q("#untitled"))).toBeNull();
    expect(pathOfTarget(q("#sw"))).toBe("sw.excalidraw");
    expect(pathOfTarget(document.body)).toBeNull();
  });

  it("starts a read on a press and keeps it for the open", async () => {
    setup();
    press(document.querySelector("#name")!);
    expect(reads).toEqual(["a.excalidraw"]);
    expect(await takeSpeculativeRead("h", "a.excalidraw")).toBeTruthy();
  });

  it("ignores folders, the open drawing, no vault and other buttons", () => {
    setup("tab.excalidraw");
    press(document.querySelector("[data-tree-kind=folder]")!);
    press(document.querySelector("#tab")!);
    document.querySelector("#name")!.dispatchEvent(
      pointerEvent("pointerdown", {
        bubbles: true,
        button: 2,
        isPrimary: true,
      }),
    );
    expect(reads).toEqual([]);
    cleanup?.();
    setup(null, null);
    press(document.querySelector("#name")!);
    expect(reads).toEqual([]);
  });

  it("drops the entry when the pointer turns into a drag", () => {
    setup();
    press(document.querySelector("#name")!, 10, 10);
    expect(hasSpeculativeOpen()).toBe(true);
    document.dispatchEvent(
      pointerEvent("pointermove", {
        bubbles: true,
        clientX: 40,
        clientY: 10,
      }),
    );
    expect(hasSpeculativeOpen()).toBe(false);
  });

  it("keeps the entry across a small move and the release", () => {
    setup();
    press(document.querySelector("#name")!, 10, 10);
    document.dispatchEvent(
      pointerEvent("pointermove", {
        bubbles: true,
        clientX: 12,
        clientY: 11,
      }),
    );
    document.dispatchEvent(pointerEvent("pointerup", { bubbles: true }));
    expect(hasSpeculativeOpen()).toBe(true);
  });

  it("removes the listener and the entry when switched off", () => {
    setup();
    press(document.querySelector("#name")!);
    cleanup?.();
    cleanup = null;
    expect(hasSpeculativeOpen()).toBe(false);
    press(document.querySelector("#name")!);
    expect(reads).toEqual(["a.excalidraw"]);
  });
});
