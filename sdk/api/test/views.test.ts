import { screen, fireEvent } from "@testing-library/react";
import { createElement as h, useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { boot } from "../testing";

import type { Plugin, PluginContext, ViewProps } from "../src/index";
import type { TestPlugin } from "../testing";

const manifest = (permissions: ("vault.read" | "vault.write")[]) => ({
  id: "board",
  permissions,
  contributes: {
    views: [{ id: "b", extensions: ["kanban.md"] }],
  },
});

/** Shows the note text; the button saves "changed" with the revision it read. */
function View({ path, file }: ViewProps) {
  const [state, setState] = useState("loading");
  const [rev, setRev] = useState("");
  useEffect(() => {
    file.read().then(
      (d) => {
        setState(d.text);
        setRev(d.revision);
      },
      (e) => setState(`error: ${e.message}`),
    );
  }, [file]);
  return h(
    "div",
    null,
    h("p", null, `${path}: ${state}`),
    h(
      "button",
      {
        onClick: () =>
          void file.write("changed", rev).then(
            (r) => setState(`saved ${r.revision.length}`),
            (e) => setState(`error: ${e.code ?? e.message}`),
          ),
      },
      "save",
    ),
  );
}

const plugin: Plugin = {
  activate(ctx) {
    ctx.views.register("b", View);
    ctx.views.register("nope", View);
  },
};

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("mock host: ctx.views", () => {
  it("opens a note in its view, reads and saves through the permissions", async () => {
    p = await boot(manifest(["vault.read", "vault.write"]), plugin);
    p.notes.seed("a/x.kanban.md", "hello");
    await p.openView("a/x.kanban.md");
    expect(await screen.findByText("a/x.kanban.md: hello")).toBeTruthy();
    fireEvent.click(screen.getByText("save"));
    expect(await screen.findByText(/saved 64/)).toBeTruthy();
    expect(p.notes.text("a/x.kanban.md")).toBe("changed");
    expect(
      p.log().some((l) => /view "nope" is not declared/.test(l.text)),
    ).toBe(true);
  });

  it("refuses reading and writing without the permissions", async () => {
    p = await boot(manifest([]), plugin);
    p.notes.seed("x.kanban.md", "secret");
    await p.openView("x.kanban.md");
    expect(await screen.findByText(/error: .*vault\.read/)).toBeTruthy();
  });

  it("a write after the file changed is refused with CONFLICT", async () => {
    p = await boot(manifest(["vault.read", "vault.write"]), plugin);
    p.notes.seed("x.kanban.md", "one");
    await p.openView("x.kanban.md");
    await screen.findByText("x.kanban.md: one");
    p.notes.seed("x.kanban.md", "two");
    fireEvent.click(screen.getByText("save"));
    expect(await screen.findByText(/error: CONFLICT/)).toBeTruthy();
    expect(p.notes.text("x.kanban.md")).toBe("two");
  });

  it("no view is declared for another name", async () => {
    p = await boot(manifest([]), plugin);
    await expect(p.openView("x.md")).rejects.toThrow(/no view is declared/);
  });

  it("views.open: a panel id opens the side panel, a view id opens the note in the main pane", async () => {
    let ctx!: PluginContext;
    p = await boot(
      {
        id: "lay",
        activation: ["onStartupFinished"],
        contributes: {
          panels: [{ id: "side" }],
          views: [{ id: "b", extensions: ["kanban.md"] }],
        },
      },
      {
        activate(c) {
          ctx = c;
        },
      },
    );
    await ctx.views.open("side");
    expect(p.openPanelIds()).toEqual(["side"]);
    await ctx.views.open("b", { path: "x/y.kanban.md", newTab: true });
    expect(p.workspace.opened()).toEqual([
      { path: "x/y.kanban.md", newTab: true },
    ]);
    for (const [id, opts] of [
      ["b", { path: "y.md" }],
      ["b", {}],
      ["nope", {}],
    ] as const) {
      await expect(ctx.views.open(id, opts)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    }
    await expect(
      ctx.views.open("b", { path: "../y.kanban.md" }),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    p.vault.setVault(null);
    await expect(
      ctx.views.open("b", { path: "z.kanban.md" }),
    ).rejects.toMatchObject({ code: "NO_VAULT" });
  });
});
