import { describe, expect, it, vi } from "vitest";

import {
  getActiveEditor,
  onActiveEditorChange,
  registerEditorApi,
} from "./editorApi";

const api = {} as any;
const tick = () => Promise.resolve();

describe("active editor", () => {
  it("is null until registered, carries live meta, and clears on unregister", async () => {
    expect(getActiveEditor()).toBeNull();
    const cb = vi.fn();
    const off = onActiveEditorChange(cb);
    let path = "a.excalidraw";
    const unregister = registerEditorApi("d1", api, () => ({
      path,
      readOnly: true,
    }));
    expect(getActiveEditor()).toEqual({
      documentId: "d1",
      api,
      path: "a.excalidraw",
      readOnly: true,
    });
    path = "b.excalidraw";
    expect(getActiveEditor()?.path).toBe("b.excalidraw");
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
    unregister();
    expect(getActiveEditor()).toBeNull();
    await tick();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it("coalesces a switch (unregister then register) into one notification", async () => {
    const un1 = registerEditorApi("d1", api);
    await tick();
    const cb = vi.fn();
    const off = onActiveEditorChange(cb);
    un1();
    const un2 = registerEditorApi("d2", api);
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getActiveEditor()?.documentId).toBe("d2");
    expect(getActiveEditor()?.path).toBeNull();
    // a stale cleanup of d1 must not clear d2
    un1();
    expect(getActiveEditor()?.documentId).toBe("d2");
    un2();
    off();
  });
});
