import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  commandHandlersVersion,
  getRegisteredHandler,
} from "../commands/handlerRegistry";
import { useEditorPalette } from "../editor/useEditorPalette";
import { LibraryStore } from "../library/libraryStore";

import type { LibraryRepository } from "../library/types";

const options = (libraryStore: LibraryStore | null) => ({
  apiRef: { current: null },
  disabled: false,
  presets: [],
  activePen: null,
  selectPen: () => {},
  openPaperSettings: () => {},
  libraryStore,
});

describe("useEditorPalette binding", () => {
  it("binds the editor commands, library toggle included, in one registry change at mount", () => {
    const store = new LibraryStore({} as LibraryRepository);
    const before = commandHandlersVersion();
    const { unmount } = renderHook(() => useEditorPalette(options(store)));
    expect(commandHandlersVersion() - before).toBe(1);
    expect(getRegisteredHandler("library.toggle")).toBeTypeOf("function");
    unmount();
    expect(getRegisteredHandler("library.toggle")).toBeUndefined();
  });
});
