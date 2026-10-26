/**
 * Links written before the vault file list has loaded (files.list_start)
 * must still get their short name: the writers wait for the complete list,
 * styling never shows a link as broken from a partial list, and `[[`
 * suggestions wait for the list.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getRegisteredHandler } from "../../commands/handlerRegistry";
import { createResolver } from "../../links/resolve";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { provisionalResolver } from "./useEditorLinks";
import { useVaultEditorLinks } from "./useVaultEditorLinks";
import { WikiAutocomplete } from "./wikiAutocomplete";

import type { EditorLinksWiring } from "./useVaultEditorLinks";

const FULL = ["Hub.excalidraw", "Folder/Inner.excalidraw"];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function fakeApi() {
  const elements = [{ id: "r1", type: "rectangle", isDeleted: false }];
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({ selectedElementIds: { r1: true } }),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

function wiring(over: Partial<EditorLinksWiring>): EditorLinksWiring {
  return {
    settings: {
      ...DEFAULT_LINKS_SETTINGS,
      styleLinks: false,
      autocomplete: false,
      hoverPreview: "off",
    },
    names: [],
    currentPath: "Hub.excalidraw",
    callbacks: {
      openDrawing: vi.fn(),
      onUnresolved: vi.fn(),
      onCreate: vi.fn(),
    },
    links: null,
    handle: "h",
    pickDrawing: async () => "Folder/Inner.excalidraw",
    bridge: { current: null },
    ...over,
  };
}

const linksOf = (updateScene: ReturnType<typeof vi.fn>) =>
  updateScene.mock.calls.flatMap(([u]) =>
    (u.elements ?? []).map((e: { link?: string }) => e.link),
  );

describe("link names before the file list has loaded", () => {
  it("Link selection waits for the complete list and writes the short name", async () => {
    const { api, updateScene } = fakeApi();
    const list = deferred<readonly string[]>();
    const loadNames = vi.fn(() => list.promise);
    const hook = renderHook(() =>
      useVaultEditorLinks(
        api,
        null,
        wiring({ names: [], namesReady: false, loadNames }),
      ),
    );
    const run = act(async () => {
      await getRegisteredHandler("links.linkSelection")!();
    });
    await vi.waitFor(() => expect(loadNames).toHaveBeenCalled());
    // Nothing is written while the list is still loading.
    expect(updateScene).not.toHaveBeenCalled();
    list.resolve(FULL);
    await run;
    expect(linksOf(updateScene)).toEqual(["[[Inner]]"]);
    hook.unmount();
  });

  it("without the wait, a partial list would have written the path form", () => {
    expect(createResolver([]).shortestTarget("Folder/Inner.excalidraw")).toBe(
      "Folder/Inner",
    );
    expect(createResolver(FULL).shortestTarget("Folder/Inner.excalidraw")).toBe(
      "Inner",
    );
  });

  it("styling counts an unknown target as resolved while loading, and asks for the list", async () => {
    const onNeedNames = vi.fn();
    const r = provisionalResolver(createResolver([]), {
      current: { onNeedNames },
    });
    expect(r.resolveTarget("Hub.excalidraw", "Inner").path).not.toBeNull();
    await Promise.resolve();
    expect(onNeedNames).toHaveBeenCalled();
    // A known target keeps its real resolution.
    const known = provisionalResolver(createResolver(FULL), {
      current: {},
    });
    expect(known.resolveTarget("Hub.excalidraw", "Inner").path).toBe(
      "Folder/Inner.excalidraw",
    );
  });

  it("`[[` suggestions wait for the list, then show on the next refresh", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let ready = false;
    const engine = new WikiAutocomplete({
      container,
      getNames: () => (ready ? FULL : []),
      namesReady: () => ready,
      getResolver: () => createResolver(ready ? FULL : []),
      getSettings: () => DEFAULT_LINKS_SETTINGS,
      getCurrentPath: () => "Hub.excalidraw",
      onCreate: vi.fn(),
    });
    engine.start();
    const ta = document.createElement("textarea");
    ta.className = "excalidraw-wysiwyg";
    container.appendChild(ta);
    return vi
      .waitFor(() => {
        // attached by the MutationObserver
        ta.value = "[[Inn";
        ta.setSelectionRange(5, 5);
        ta.dispatchEvent(new Event("input"));
        expect(engine.state).toBeNull(); // no "Create 'Inn'" for a known drawing
      })
      .then(() => {
        ready = true;
        engine.namesChanged();
        expect(engine.state?.rows.map((r) => r.target)).toEqual(["Inner"]);
        engine.stop();
      });
  });
});
