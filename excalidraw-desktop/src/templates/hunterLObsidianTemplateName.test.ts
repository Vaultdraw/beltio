/**
 * Hunter L (2026-10-30 night) [notes] (Obsidian vault compatibility), family of toimprove 236
 * (a7ae687d: an Obsidian drawing's shown name drops .excalidraw.md everywhere).
 *
 * L-11: "Templates: Save drawing as template" on an open Obsidian drawing (`Plan.excalidraw.md`)
 * prefills the name with `stripDrawingExt(base)` (useTemplates.tsx ~169), which strips only
 * `.excalidraw`, so the dialog reads "Plan.excalidraw.md". Saving it as offered writes
 * `Templates/Plan.excalidraw.md.excalidraw`, listed in the picker as "Plan.excalidraw.md".
 * The guard drawingNameStrip.guard.test.ts pins this call as "templates are .excalidraw files",
 * but the name comes from the source drawing. Expected: "Plan", like the tab, tree and exports.
 */
import { describe, expect, it } from "vitest";

import { FakeVaultRepository } from "../tests/fakeVaultRepository";
import { drawingStem } from "../vault/fileKind";

import { createGlobalTemplateStore } from "./globalTemplates";
import { saveAsTemplate } from "./saveTemplate";

const deps = () => {
  const repository = new FakeVaultRepository();
  const global = createGlobalTemplateStore({ tauri: false });
  return { repository, handle: repository.handle, folder: "Templates", global };
};

// the dialog's prefilled name, exactly as useTemplates.tsx computes it (drawingStem, toimprove 277)
const prefilled = (path: string) => drawingStem(path.split("/").pop()!);

describe("hunter L-11: a template saved from an Obsidian drawing", () => {
  it("sanity: a .excalidraw drawing gives a clean name", async () => {
    const entry = await saveAsTemplate({
      ...deps(),
      scope: "vault",
      name: prefilled("Drawings/Plan.excalidraw"),
      json: "{}",
    });
    expect(entry.name).toBe("Plan");
  });

  it("an Obsidian drawing's template is named like the drawing, without .excalidraw.md", async () => {
    const path = "Drawings/Plan.excalidraw.md";
    expect(drawingStem("Plan.excalidraw.md")).toBe("Plan");
    const entry = await saveAsTemplate({
      ...deps(),
      scope: "vault",
      name: prefilled(path),
      json: "{}",
    });
    expect(entry.name).toBe("Plan");
    expect(entry.path).toBe("Templates/Plan.excalidraw");
  });
});
