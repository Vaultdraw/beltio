import { afterEach, describe, expect, it, vi } from "vitest";

import { onEditorPaste } from "../../editor/pastePlugins";

import {
  addPasteHandler,
  pasteHandlerCount,
  routePaste,
  setPasteStarter,
} from "./pasteRouter";

afterEach(() => setPasteStarter(null));

describe("routePaste", () => {
  it("ignores single lines and costs nothing with no handler", async () => {
    const starter = vi.fn(async () => {});
    setPasteStarter(starter);
    expect(await routePaste("one line")).toBe(false);
    expect(starter).not.toHaveBeenCalled();
  });

  it("starts the plugins on the first multi-line paste, then asks the handlers", async () => {
    const run = vi.fn(() => "handled" as const);
    let off = () => {};
    setPasteStarter(async () => {
      off = addPasteHandler("p", run);
    });
    expect(pasteHandlerCount()).toBe(0);
    expect(await routePaste("a\nb")).toBe(true);
    expect(run).toHaveBeenCalledWith({ text: "a\nb" });
    off();
    expect(pasteHandlerCount()).toBe(0);
  });

  it("lets the paste through when handlers pass, throw or are absent", async () => {
    const off1 = addPasteHandler("a", () => "pass");
    const off2 = addPasteHandler("b", () => {
      throw new Error("boom");
    });
    const off3 = addPasteHandler("c", () => undefined);
    expect(await routePaste("a\nb")).toBe(false);
    [off1, off2, off3].forEach((o) => o());
  });

  it("stops at the first handler that handles it", async () => {
    const second = vi.fn();
    const off1 = addPasteHandler("a", async () => "handled" as const);
    const off2 = addPasteHandler("b", second);
    expect(await routePaste("a\nb")).toBe(true);
    expect(second).not.toHaveBeenCalled();
    off1();
    off2();
  });
});

describe("onEditorPaste", () => {
  it("never shows plugins copied shapes, files or mixed content", async () => {
    const run = vi.fn(() => "handled" as const);
    const off = addPasteHandler("a", run);
    expect(await onEditorPaste({ text: "a\nb", elements: [{}] })).toBe(true);
    expect(await onEditorPaste({ text: "a\nb", files: { x: {} } })).toBe(true);
    expect(await onEditorPaste({ text: "a\nb", mixedContent: [] })).toBe(true);
    expect(await onEditorPaste({})).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(await onEditorPaste({ text: "a\nb" })).toBe(false);
    off();
  });
});
