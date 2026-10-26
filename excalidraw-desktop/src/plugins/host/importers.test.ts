import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findImporter, runImports } from "../importerMap";
import { boot, type TestPlugin } from "../testing";

import { getRuntime } from "./activation";
import { getImporter } from "./importerRegistry";

import type { Importer, Plugin, PluginContext } from "../api";

let t: TestPlugin | undefined;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const textOp = (text: string, x = 0, y = 0) => ({
  op: "add" as const,
  element: { type: "text" as const, text, x, y },
});

/** A plugin with one `txt` importer (and any extra ones declared) running `importer`. */
const bootImporter = async (
  importer: Importer,
  opts: {
    activate?: (ctx: PluginContext) => void;
    register?: boolean;
    permissions?: ("vault.read" | "vault.write")[];
  } = {},
) => {
  const plugin: Plugin = {
    activate(ctx) {
      opts.activate?.(ctx);
      if (opts.register !== false) {
        ctx.importers.register("txt", importer);
      }
    },
  };
  t = await boot(
    {
      id: "imp",
      name: "Importer",
      permissions: opts.permissions ?? [],
      contributes: { importers: [{ id: "txt", extensions: ["txt"] }] },
    },
    plugin,
  );
  return t;
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("import runner", () => {
  it("activates the plugin once, on the first matching file, and applies ops at the drop point", async () => {
    const activate = vi.fn();
    const p = await bootImporter(
      {
        async import(input, { at }) {
          return { ops: [textOp(await input.text(), at.x, at.y)] };
        },
      },
      { activate },
    );
    expect(activate).not.toHaveBeenCalled();
    await p.import("a.txt", "hello", { x: 40, y: 50 });
    await p.import("b.TXT", "again", { x: 1, y: 2 });
    expect(activate).toHaveBeenCalledTimes(1);
    const texts = p.scene
      .live()
      .map((e) => [(e as { text?: string }).text, e.x, e.y]);
    expect(texts).toEqual([
      ["hello", 40, 50],
      ["again", 1, 2],
    ]);
  });

  it("applies all returned ops as one undo step", async () => {
    const p = await bootImporter({
      import: () => ({ ops: [textOp("a"), textOp("b", 10, 10), textOp("c")] }),
    });
    const batch = await p.import("a.txt", "x");
    expect(p.scene.batches).toHaveLength(1);
    expect(batch?.elements).toHaveLength(3);
  });

  it("an importer can return an image op (hashed, stored once, one undo step)", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5,
    ]);
    const pic = {
      op: "add",
      element: {
        type: "image",
        width: 20,
        height: 20,
        image: { mime: "image/png", bytes: png },
      },
    } as const;
    const p = await bootImporter({ import: () => ({ ops: [pic, pic] }) });
    const batch = await p.import("a.txt", "x");
    expect(batch?.elements).toHaveLength(2);
    expect(p.scene.batches).toHaveLength(1);
    expect(Object.keys(p.scene.files())).toHaveLength(1);
  });

  it("passes the drawing path, a signal, the file name and decodes UTF-8 with replacement", async () => {
    let seen: unknown;
    const p = await bootImporter({
      async import(input, opts) {
        seen = {
          name: input.name,
          size: input.size,
          path: opts.path,
          aborted: opts.signal.aborted,
          text: await input.text(),
          bytes: (await input.bytes()).length,
        };
      },
    });
    await p.import("dir/a.txt", new Uint8Array([104, 105, 0xff, 33]));
    expect(seen).toEqual({
      name: "a.txt",
      size: 4,
      path: "fake.excalidraw",
      aborted: false,
      text: "hi�!",
      bytes: 4,
    });
    expect(p.scene.batches).toHaveLength(0);
  });

  it("an importer that registered nothing gets a toast naming it", async () => {
    const p = await bootImporter(
      { import: () => undefined },
      { register: false },
    );
    expect(await p.import("a.txt", "x")).toBeNull();
    expect(p.toasts()).toEqual([
      "Importer: importer txt declared but not registered",
    ]);
  });

  it("refuses an importer id plugin.toml does not declare", async () => {
    const p = await bootImporter(
      { import: () => undefined },
      {
        activate: (ctx) => void ctx.importers.register("nope", { import() {} }),
      },
    );
    await p.import("a.txt", "x");
    expect(p.log().map((l) => l.text)).toContain(
      'register: importer "nope" is not declared in plugin.toml',
    );
  });

  it("a throwing importer is toasted, attributed and applies nothing", async () => {
    const p = await bootImporter({
      import() {
        throw new Error("boom");
      },
    });
    expect(await p.import("a.txt", "x")).toBeNull();
    expect(p.toasts()).toEqual(["Importer: import of a.txt failed: boom"]);
    expect(p.log().map((l) => l.text)).toContain("importer txt: boom");
    expect(p.scene.live()).toHaveLength(0);
  });

  it("bad ops are reported against the plugin and nothing is applied", async () => {
    const p = await bootImporter({
      import: () => ({
        ops: [{ op: "add", element: { type: "star" } } as never],
      }),
    });
    expect(await p.import("a.txt", "x")).toBeNull();
    expect(p.toasts()[0]).toMatch(/^Importer: import of a\.txt failed/);
    expect(p.scene.batches).toHaveLength(0);
    expect(p.log().some((l) => l.level === "error")).toBe(true);
  });

  it("aborts the signal on a drawing switch and applies nothing (DRAWING_CHANGED)", async () => {
    const gate = deferred();
    let signal!: AbortSignal;
    const p = await bootImporter({
      async import(_i, opts) {
        signal = opts.signal;
        await gate.promise;
        return { ops: [textOp("late")] };
      },
    });
    const done = p.import("a.txt", "x");
    await p.flush();
    p.events.emit("drawing.opened", { path: "other.excalidraw" });
    expect(signal.aborted).toBe(true);
    gate.resolve();
    expect(await done).toBeNull();
    expect(p.scene.live()).toHaveLength(0);
    expect(p.toasts()[0]).toContain("DRAWING_CHANGED");
  });

  it("refuses to apply when the active drawing is no longer the target", async () => {
    const p = await bootImporter({
      async import() {
        t!.scene.switchTo("b.excalidraw");
        return { ops: [textOp("late")] };
      },
    });
    expect(await p.import("a.txt", "x")).toBeNull();
    expect(p.scene.batches).toHaveLength(0);
    expect(p.toasts()[0]).toContain("DRAWING_CHANGED");
  });

  it("Import: Cancel aborts the running import", async () => {
    const gate = deferred();
    let signal!: AbortSignal;
    const p = await bootImporter({
      async import(_i, opts) {
        signal = opts.signal;
        await gate.promise;
        return { ops: [textOp("late")] };
      },
    });
    expect(p.cancelImport()).toBe(false);
    const done = p.import("a.txt", "x");
    await p.flush();
    expect(p.cancelImport()).toBe(true);
    expect(signal.aborted).toBe(true);
    gate.resolve();
    expect(await done).toBeNull();
    expect(p.toasts()).toEqual(["Importer: the import was cancelled"]);
    expect(p.scene.live()).toHaveLength(0);
  });

  it("an importer that throws on abort is not reported as failed", async () => {
    const gate = deferred();
    const p = await bootImporter({
      async import(_i, { signal }) {
        await gate.promise;
        if (signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
      },
    });
    const done = p.import("a.txt", "x");
    await p.flush();
    expect(p.cancelImport()).toBe(true);
    gate.resolve();
    await done;
    expect(p.toasts()).toEqual(["Importer: the import was cancelled"]);
    expect(p.log().some((l) => l.level === "error")).toBe(false);
  });

  it("Cancel during activation stops the import before the importer runs", async () => {
    const gate = deferred();
    const run = vi.fn();
    t = await boot(
      {
        id: "imp",
        name: "Importer",
        contributes: { importers: [{ id: "txt", extensions: ["txt"] }] },
      },
      {
        async activate(ctx) {
          await gate.promise; // a slow first load
          ctx.importers.register("txt", { import: run });
        },
      },
    );
    const done = t.import("a.txt", "x");
    await t.flush();
    expect(t.cancelImport()).toBe(true);
    gate.resolve();
    expect(await done).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(t.toasts()).toEqual(["Importer: the import was cancelled"]);
  });

  it("a register call after the plugin stopped is ignored", async () => {
    let ctx!: PluginContext;
    const p = await bootImporter(
      { import: () => undefined },
      { register: false, activate: (c) => (ctx = c) },
    );
    await p.import("a.txt", "x");
    const rt = getRuntime("imp")!;
    await p.disable();
    ctx.importers.register("txt", { import: () => undefined });
    expect(getImporter(rt, "txt")).toBeUndefined();
  });

  it("stopping the plugin aborts its running import", async () => {
    const gate = deferred();
    let signal!: AbortSignal;
    const p = await bootImporter({
      async import(_i, opts) {
        signal = opts.signal;
        await gate.promise;
      },
    });
    const done = p.import("a.txt", "x");
    await p.flush();
    await p.disable();
    expect(signal.aborted).toBe(true);
    gate.resolve();
    await done;
  });

  it("runs one import at a time: a second gets a toast", async () => {
    const gate = deferred();
    const p = await bootImporter({
      async import(input) {
        await gate.promise;
        return { ops: [textOp(await input.text())] };
      },
    });
    const first = p.import("a.txt", "one");
    await p.flush();
    expect(await p.import("b.txt", "two")).toBeNull();
    expect(p.toasts()).toEqual([
      "An import is already running. Wait for it, or run Import: Cancel.",
    ]);
    gate.resolve();
    await first;
    expect(p.scene.live().map((e) => (e as { text?: string }).text)).toEqual([
      "one",
    ]);
    // and the lock is released afterwards
    await p.import("c.txt", "three");
    expect(p.scene.live()).toHaveLength(2);
  });

  it("refuses a read-only drawing", async () => {
    const p = await bootImporter({ import: () => ({ ops: [textOp("a")] }) });
    p.scene.readOnly(true);
    expect(await p.import("a.txt", "x")).toBeNull();
    expect(p.toasts()).toEqual(["This drawing is read-only"]);
  });

  it("refuses a file over 32 MiB before the plugin loads", async () => {
    const activate = vi.fn();
    const p = await bootImporter({ import: () => undefined }, { activate });
    const file = new File(["x"], "huge.txt");
    Object.defineProperty(file, "size", { value: 32 * 1024 * 1024 + 1 });
    const match = findImporter("huge.txt")!;
    await runImports([{ file, match }], {
      path: "fake.excalidraw",
      at: { x: 0, y: 0 },
    });
    expect(activate).not.toHaveBeenCalled();
    expect(p.toasts()).toEqual(["huge.txt is over 32 MiB, so it was skipped"]);
  });

  it("runs several files one after another", async () => {
    const order: string[] = [];
    const p = await bootImporter({
      async import(input) {
        order.push(input.name);
        return { ops: [textOp(input.name)] };
      },
    });
    const items = ["a.txt", "b.txt"].map((n) => ({
      file: new File(["x"], n),
      match: findImporter(n)!,
    }));
    await runImports(items, { path: "fake.excalidraw", at: { x: 0, y: 0 } });
    expect(order).toEqual(["a.txt", "b.txt"]);
    expect(p.scene.batches).toHaveLength(2);
  });
});

describe("importer stubs", () => {
  it("claim extensions at registration without loading code, and release them on disable", async () => {
    const { makePluginInfo } = await import("./fakeBackend");
    const { setupHost, enable, tick } = await import("./testUtils");
    const { startPluginHost } = await import("./start");
    const { ensureActive } = await import("./activation");
    const plain = makePluginInfo("plain"); // no importers key at all
    const info = makePluginInfo("stubby", {
      contributes: {
        commands: [],
        panels: [],
        settings: [],
        importers: [{ id: "txt", title: "Text", extensions: ["txt", "text"] }],
      },
    });
    const activate = vi.fn((ctx: PluginContext) => {
      ctx.importers.register("txt", { import: () => ({ ops: [] }) });
    });
    const h = setupHost([plain, info], {
      stubby: { activate },
      plain: { activate: () => {} },
    });
    const host = await startPluginHost(window, (run) => run());
    enable(["plain", "stubby"]);
    await tick();
    expect(findImporter("x.TEXT")).toMatchObject({
      pluginId: "stubby",
      importerId: "txt",
      title: "Text",
      extension: "text",
    });
    expect(h.loads).toEqual([]);
    expect(activate).not.toHaveBeenCalled();
    // an import can activate it
    expect(await ensureActive("stubby")).toBe(true);
    enable(["plain"]);
    await tick();
    expect(findImporter("x.txt")).toBeNull();
    enable([]);
    await tick();
    host.stop();
  });
});
