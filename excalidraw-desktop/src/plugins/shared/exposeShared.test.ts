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
    expect(Object.keys(first)).toEqual(SHARED_MODULES.map((m) => m.globalKey));
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
});
