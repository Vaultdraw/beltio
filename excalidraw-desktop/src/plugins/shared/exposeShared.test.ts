import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { exposeSharedModules } from "./exposeShared";
import { SHARED_MODULES } from "./specifiers";

const req = createRequire(import.meta.url);

describe("exposeSharedModules", () => {
  it("publishes every shared module and is idempotent", () => {
    const win = {} as Window;
    exposeSharedModules(win);
    const first = (win as any).__vaultdraw;
    expect(Object.keys(first)).toEqual([
      ...SHARED_MODULES.filter((m) => !m.lazy).map((m) => m.globalKey),
      "load",
    ]);
    exposeSharedModules(win);
    expect((win as any).__vaultdraw).toBe(first);
  });

  it("namespaces carry the runtime keys the shims re-export", () => {
    const win = {} as Window;
    exposeSharedModules(win);
    const shared = (win as any).__vaultdraw;
    for (const spec of [
      "react",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
    ]) {
      for (const key of Object.keys(req(spec))) {
        expect(shared[spec], `${spec}.${key}`).toHaveProperty(key);
      }
    }
  });

  it("has no static import of any CodeMirror or lezer module", () => {
    const src = readFileSync(path.join(__dirname, "exposeShared.ts"), "utf8");
    expect(src).not.toMatch(
      /^\s*import\b[^;]*from\s+["'](@codemirror|@lezer)/m,
    );
    expect(src).not.toMatch(/^\s*import\s+["'](@codemirror|@lezer)/m);
  });

  it("load resolves lazy modules, caches them and rejects unknown keys", async () => {
    const win = {} as Window;
    exposeSharedModules(win);
    const { load } = (win as any).__vaultdraw;
    const view = await load("@codemirror/view");
    expect(view).toHaveProperty("EditorView");
    expect(load("@codemirror/view")).toBe(load("@codemirror/view"));
    await expect(load("nope")).rejects.toThrow();
    for (const m of SHARED_MODULES.filter((x) => x.lazy)) {
      expect(Object.keys(await load(m.globalKey)).length).toBeGreaterThan(0);
    }
  });
});
