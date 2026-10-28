import { readFileSync } from "node:fs";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

// Load the (mocked) renderer once, so no test waits for its first import.
beforeAll(
  () => import("../../../../excalidraw-desktop/src/export/renderExport"),
);

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
  vi.useRealTimers();
});

// The real renderer needs a canvas: the test renders "mock-<format>:<drawing file name>".
vi.mock("../../../../excalidraw-desktop/src/export/renderExport", () => ({
  renderExport: async (json: string, name: string, format: string) => {
    const live = (JSON.parse(json).elements ?? []).filter(
      (e: { isDeleted?: boolean }) => !e.isDeleted,
    );
    if (live.length === 0) {
      const { emptyCanvasError } = await import(
        "../../../../excalidraw-desktop/src/export/exportError"
      );
      throw emptyCanvasError();
    }
    return {
      bytes: new TextEncoder().encode(`mock-${format}:${name}`),
      mime: "image/svg+xml",
      fileName: name,
    };
  },
}));

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

const rect = { type: "rectangle", x: 0, y: 0, width: 10, height: 10 } as const;
const note = (text: string) =>
  ({ type: "text", x: 0, y: 0, width: 10, height: 10, text } as const);

// Settings outlive a booted plugin in the test host: every test starts from the defaults.
const DEFAULTS: Record<string, unknown> = {
  enabled: false,
  formats: "svg",
  scale: 1,
  background: true,
  theme: "light",
  folder: "",
  exclude: "",
  skip_tag: "#no-export",
  on_rename: "move",
  on_delete: "remove",
  debounce_ms: 200,
  notify: false,
};

const start = async (settings: Record<string, unknown> = {}) => {
  vi.useFakeTimers();
  p = await boot(manifest(), plugin);
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...settings })) {
    await p.setSetting(k, v);
  }
  return p;
};

const saved = async (t: TestPlugin, path: string) => {
  t.events.emit("drawing.saved", { path });
  await vi.advanceTimersByTimeAsync(400);
  await vi.advanceTimersByTimeAsync(400);
};

describe("auto-export plugin", () => {
  it("declares its commands and settings, with export off by default", () => {
    const info = manifest();
    expect(info.contributes.commands?.map((c) => c.id)).toEqual([
      "export-all",
      "export-current",
    ]);
    const enabled = info.contributes.settings?.find((s) => s.key === "enabled");
    expect(enabled?.default).toBe(false);
    expect(info.activation).toContain("onStartupFinished");
  });

  it("does nothing while enabled is false", async () => {
    const t = await start();
    t.vault.seed({ "A.excalidraw": [rect] });
    await saved(t, "A.excalidraw");
    expect(t.vault.exports()).toEqual({});
  });

  it("exports next to the drawing after the debounce once turned on", async () => {
    const t = await start();
    t.vault.seed({ "Notes/A.excalidraw": [rect] });
    await t.setSetting("enabled", true);
    await vi.advanceTimersByTimeAsync(50);
    t.events.emit("drawing.saved", { path: "Notes/A.excalidraw" });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.vault.exports()).toEqual({}); // still debouncing
    // The first render loads the renderer module, which takes real time.
    await vi.waitFor(() =>
      expect(t.vault.exports()).toEqual({
        "Notes/A.svg": "mock-svg:A.excalidraw",
      }),
    );
  });

  it("restarts the wait on every save, so many saves make one export", async () => {
    const t = await start({ enabled: true });
    t.vault.seed({ "A.excalidraw": [rect] });
    for (let i = 0; i < 5; i++) {
      t.events.emit("drawing.saved", { path: "A.excalidraw" });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(t.vault.exports()).toEqual({});
    await vi.advanceTimersByTimeAsync(800);
    expect(Object.keys(t.vault.exports())).toEqual(["A.svg"]);
  });

  it("mirrors folders into the export folder, in both formats", async () => {
    const t = await start({
      enabled: true,
      folder: "exports/",
      formats: "both",
    });
    t.vault.seed({ "Notes/A.excalidraw": [rect] });
    await saved(t, "Notes/A.excalidraw");
    expect(Object.keys(t.vault.exports()).sort()).toEqual([
      "exports/Notes/A.png",
      "exports/Notes/A.svg",
    ]);
  });

  it("skips excluded folders, drawings inside the export folder and the skip tag", async () => {
    const t = await start({
      enabled: true,
      folder: "out",
      exclude: "Private, Scratch/old",
    });
    t.vault.seed({
      "Private/A.excalidraw": [rect],
      "Scratch/old/B.excalidraw": [rect],
      "out/C.excalidraw": [rect],
      "D.excalidraw": [rect, note("draft #No-Export")],
      "E.excalidraw": [rect],
    });
    for (const path of Object.keys(t.vault.drawings())) {
      await saved(t, path);
    }
    expect(Object.keys(t.vault.exports())).toEqual(["out/E.svg"]);
  });

  it("refuses an export folder that starts with a dot", async () => {
    const t = await start({ enabled: true, folder: ".hidden" });
    t.vault.seed({ "A.excalidraw": [rect] });
    await saved(t, "A.excalidraw");
    expect(t.vault.exports()).toEqual({});
  });

  it("stops listening when turned off again", async () => {
    const t = await start({ enabled: true });
    t.vault.seed({ "A.excalidraw": [rect] });
    await t.setSetting("enabled", false);
    await saved(t, "A.excalidraw");
    expect(t.vault.exports()).toEqual({});
  });

  it("writes nothing for an empty drawing", async () => {
    const t = await start({ enabled: true });
    t.vault.seed({ "A.excalidraw": [] });
    await saved(t, "A.excalidraw");
    expect(t.vault.exports()).toEqual({});
  });

  it("moves exports with a renamed drawing and a renamed folder, or leaves them", async () => {
    const t = await start({ enabled: true, folder: "out", formats: "both" });
    t.vault.seed({ "Old/A.excalidraw": [rect] });
    await saved(t, "Old/A.excalidraw");
    t.events.emit("drawing.renamed", {
      from: "Old/A.excalidraw",
      to: "Old/B.excalidraw",
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(t.vault.exports()).sort()).toEqual([
      "out/Old/B.png",
      "out/Old/B.svg",
    ]);
    t.events.emit("drawing.renamed", { from: "Old", to: "New" });
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(t.vault.exports()).sort()).toEqual([
      "out/New/B.png",
      "out/New/B.svg",
    ]);
    await t.setSetting("on_rename", "leave");
    t.vault.seed({ "New/C.excalidraw": [rect] });
    t.events.emit("drawing.renamed", {
      from: "New/B.excalidraw",
      to: "New/C.excalidraw",
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(Object.keys(t.vault.exports()).sort()).toEqual([
      "out/New/B.png",
      "out/New/B.svg",
      "out/New/C.png",
      "out/New/C.svg",
    ]);
  });

  it("removes exports with a deleted drawing or folder, unless told to keep them", async () => {
    const t = await start({ enabled: true, formats: "both" });
    t.vault.seed({ "A.excalidraw": [rect], "B.excalidraw": [rect] });
    await saved(t, "A.excalidraw");
    await saved(t, "B.excalidraw");
    t.events.emit("drawing.deleted", { path: "A.excalidraw" });
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(t.vault.exports()).sort()).toEqual(["B.png", "B.svg"]);
    await t.setSetting("on_delete", "leave");
    t.events.emit("drawing.deleted", { path: "B.excalidraw" });
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(t.vault.exports()).length).toBe(2);
  });

  it("Export all drawings now walks the vault, honours skips, and works while off", async () => {
    const t = await start({ exclude: "Private" });
    t.vault.seed({
      "A.excalidraw": [rect],
      "Sub/B.excalidraw": [rect],
      "Private/C.excalidraw": [rect],
      "D.excalidraw": [rect, note("#no-export")],
    });
    const done = t.run("export-all");
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(Object.keys(t.vault.exports()).sort()).toEqual([
      "A.svg",
      "Sub/B.svg",
    ]);
    expect(t.toasts().at(-1)).toMatch(/Exported 2 of 3 drawings/);
  });

  it("Export this drawing now ignores the skip tag", async () => {
    const t = await start();
    t.vault.seed({ "D.excalidraw": [rect, note("#no-export")] });
    t.scene.switchTo("D.excalidraw");
    const done = t.run("export-current");
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(Object.keys(t.vault.exports())).toEqual(["D.svg"]);
  });
});
