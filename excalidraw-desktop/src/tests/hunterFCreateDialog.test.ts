import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hunter F-13 (2026-10-30). The navigator's New drawing / New folder dialog
 * (`VaultNavigator.tsx handleCreateSubmit`) is written to stay open and show `createError` when
 * the create fails (`try { await onCreateDrawing(...); setCreateKind(null) } catch { setCreateError }`),
 * as Rename and Save as template do. The handler it is given, `VaultApp.tsx handleCreateDrawing`
 * (and `handleCreateFolder`), catches every error itself and shows a global alert, so the dialog
 * always closes and the typed name is lost: a refused name (`a:b`, `.x`, `CON`) or a name that
 * already exists means "type it all again" after a notice at the top. `createError` is dead code.
 */
const app = readFileSync(resolve(__dirname, "../VaultApp.tsx"), "utf8");
const body = (name: string) => {
  const at = app.indexOf(`const ${name} = async`);
  return app.slice(at, app.indexOf("\n  };", at));
};

describe("hunter F-13: the create dialog stays open when creating fails", () => {
  it("(context) the handler shows a global alert", () => {
    expect(body("handleCreateDrawing")).toContain("setGlobalAlert");
  });
  it.fails("handleCreateDrawing lets the dialog know (rethrows)", () => {
    expect(body("handleCreateDrawing")).toMatch(/throw /);
  });
  it.fails("handleCreateFolder lets the dialog know (rethrows)", () => {
    expect(body("handleCreateFolder")).toMatch(/throw /);
  });
});
