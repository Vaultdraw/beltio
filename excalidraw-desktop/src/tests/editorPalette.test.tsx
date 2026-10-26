import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VaultEditor } from "../editor/VaultEditor";
import { EDITOR_PALETTE_EXCLUDED } from "../palette/providers/editor";
import {
  collectPaletteItems,
  resetPaletteProviders,
} from "../palette/registry";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { LibraryStore } from "../library/libraryStore";

import type { LibraryRepository } from "../library/types";

const rect = (id: string, x: number, y: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 50,
  height: 50,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const scene = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [rect("a", 10, 10), rect("b", 200, 50)],
  appState: {},
  files: {},
});

afterEach(() => resetPaletteProviders());

const mount = (props: Record<string, unknown> = {}) =>
  render(
    <VaultEditor
      documentId="doc-palette"
      initialSource={{ json: scene }}
      name="t.excalidraw"
      onChange={() => {}}
      {...props}
    />,
  );

const find = (key: string) => collectPaletteItems().find((i) => i.key === key);

describe("editor palette provider", () => {
  it("lists editor commands, drops replaced ones, and aligns the selection", async () => {
    const saved: string[] = [];
    mount({ onChange: (json: string) => saved.push(json) });
    await waitFor(() => expect(find("editor:selectAll")).toBeTruthy());
    const keys = collectPaletteItems().map((i) => i.key);
    for (const gone of Object.keys(EDITOR_PALETTE_EXCLUDED)) {
      expect(keys).not.toContain(`editor:${gone}`);
    }
    expect(keys).toContain("editor:mermaid");
    expect(keys).toContain("editor:tool.laser");
    // Nothing selected yet: align is not offered.
    expect(find("editor:alignLeft")).toBeUndefined();

    // Run from the palette: no canvas focus involved.
    act(() => void find("editor:selectAll")!.run());
    await waitFor(() => expect(find("editor:alignLeft")).toBeTruthy());
    act(() => void find("editor:alignLeft")!.run());

    await waitFor(
      () => {
        const xs = JSON.parse(saved[saved.length - 1]).elements.map(
          (e: { x: number }) => e.x,
        );
        expect(xs).toEqual([10, 10]);
      },
      { timeout: 4000 },
    );
  });

  it("lists nothing while the editor is disabled", async () => {
    mount({ disabled: true });
    await waitFor(() => expect(find("pen:0")).toBeTruthy());
    expect(collectPaletteItems().some((i) => i.key.startsWith("editor:"))).toBe(
      false,
    );
  });

  it("binds paper and library handlers while mounted", () => {
    const repository: LibraryRepository = {
      readLibrary: async () => ({
        json: null,
        revision: null,
        unchanged: false,
        path: "",
        readOnly: true,
      }),
      writeLibrary: async () => ({ revision: "" }),
      pickLibraryFile: async () => null,
      exportFile: async () => false,
      subscribe: async () => () => {},
    };
    const { unmount } = mount({
      library: { store: new LibraryStore(repository), repository },
    });
    expect(getRegisteredHandler("paper.grid")).toBeTypeOf("function");
    expect(getRegisteredHandler("paper.settings")).toBeTypeOf("function");
    expect(getRegisteredHandler("library.toggle")).toBeTypeOf("function");
    unmount();
    expect(getRegisteredHandler("paper.grid")).toBeUndefined();
    expect(getRegisteredHandler("library.toggle")).toBeUndefined();
  });

  it("offers no library toggle without a persisted library (extensions.library off)", () => {
    mount();
    expect(getRegisteredHandler("paper.grid")).toBeTypeOf("function");
    expect(getRegisteredHandler("library.toggle")).toBeUndefined();
  });
});
