import { describe, expect, it, vi } from "vitest";

import { canAddVaultLibrary, importLibrary } from "./libraryImport";

const item = (id: string) => ({ id } as never);

const make = (
  over: {
    vault?: boolean;
    readOnly?: boolean;
    noApi?: boolean;
    hasA?: boolean;
  } = {},
) => {
  const order: string[] = [];
  const updateLibrary = vi.fn(async () => {
    order.push("update");
  });
  const store = {
    loadNow: vi.fn(async () => {
      order.push("load");
    }),
    assign: vi.fn(() => {
      order.push("assign");
    }),
    hasVault: () => over.vault ?? true,
    isVaultReadOnly: () => over.readOnly ?? false,
    getItem: (id: string) => (id === "a" && over.hasA ? item("a") : undefined),
  };
  return {
    order,
    updateLibrary,
    store,
    deps: {
      store,
      apis: () => (over.noApi ? [] : [{ updateLibrary }]),
      parse: async () => [item("a"), item("b")],
    },
  };
};

describe("importLibrary", () => {
  it("merges into the personal library through the editor, nothing assigned to the vault", async () => {
    const t = make();
    await importLibrary(t.deps, "{}", "personal");
    expect(t.order).toEqual(["load", "update"]);
    expect(t.store.assign).not.toHaveBeenCalled();
    expect(t.updateLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ merge: true, prompt: false }),
    );
  });

  it("vault scope records the new ids for the vault before the merge", async () => {
    const t = make();
    await importLibrary(t.deps, "{}", "vault");
    expect(t.order).toEqual(["load", "assign", "update"]);
    expect(t.store.assign).toHaveBeenCalledWith(["a", "b"], "vault");
  });

  it("vault scope leaves items that already exist where they are", async () => {
    const t = make({ hasA: true });
    await importLibrary(t.deps, "{}", "vault");
    expect(t.store.assign).toHaveBeenCalledWith(["b"], "vault");
  });

  it("refuses the vault library when read-only or absent, and changes nothing", async () => {
    for (const over of [{ readOnly: true }, { vault: false }]) {
      const t = make(over);
      await expect(importLibrary(t.deps, "{}", "vault")).rejects.toThrow(
        /cannot be changed/,
      );
      expect(t.updateLibrary).not.toHaveBeenCalled();
      expect(canAddVaultLibrary(t.store)).toBe(false);
    }
  });

  it("needs a mounted editor and says what to do", async () => {
    const t = make({ noApi: true });
    await expect(importLibrary(t.deps, "{}", "personal")).rejects.toThrow(
      /Open a drawing first/,
    );
  });
});
