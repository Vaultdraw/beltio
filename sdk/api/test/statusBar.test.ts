import { describe, expect, it } from "vitest";

import { cleanStatus, MAX_STATUS_TEXT } from "../shared/statusBar";
import { boot } from "../testing";

import type { PluginContext } from "../src/index";

const manifest = {
  id: "bar",
  contributes: {
    commands: [{ id: "go" }],
    status_bar: [
      { id: "a", title: "Item A", command: "go", priority: 1 },
      { id: "b", align: "left" as const },
    ],
  },
};

describe("cleanStatus", () => {
  it("hides on empty text, collapses space, cuts long text, checks the shape", () => {
    expect(cleanStatus({ text: "  " })).toBeNull();
    expect(cleanStatus({ text: " a \n b " })?.text).toBe("a b");
    const long = cleanStatus({ text: "x".repeat(200) })!;
    expect(long.text).toHaveLength(MAX_STATUS_TEXT);
    expect(long.text.endsWith("…")).toBe(true);
    expect(() => cleanStatus({ text: 1 as never })).toThrow(/string/);
    expect(() => cleanStatus({ text: "x", tone: "loud" as never })).toThrow(
      /tone/,
    );
  });
});

describe("mock host: ctx.statusBar", () => {
  it("set, update, clear and the default tooltip", async () => {
    let ctx!: PluginContext;
    const p = await boot(
      { ...manifest, activation: ["onStartupFinished"] },
      {
        activate(c) {
          ctx = c;
          c.commands.register("go", () =>
            c.statusBar.set("a", { text: "ran" }),
          );
        },
      },
    );
    expect(p.statusBar()).toEqual([]);
    ctx.statusBar.set("a", { text: "one", tone: "warn" });
    expect(p.statusBar()).toEqual([
      {
        id: "a",
        title: "Item A",
        text: "one",
        tooltip: "Item A",
        tone: "warn",
        command: "go",
      },
    ]);
    await p.clickStatusBar("a");
    expect(p.statusBar()[0].text).toBe("ran");
    ctx.statusBar.set("a", { text: "" });
    expect(p.statusBar()).toEqual([]);
    await p.dispose();
  });

  it("an undeclared item is refused and logged; disable clears the items", async () => {
    let ctx!: PluginContext;
    const p = await boot(
      { ...manifest, activation: ["onStartupFinished"] },
      {
        activate(c) {
          ctx = c;
        },
      },
    );
    ctx.statusBar.set("nope", { text: "x" });
    expect(p.log().some((l) => /not declared/.test(l.text))).toBe(true);
    const handle = ctx.statusBar.show("b", { text: "kept" });
    expect(p.statusBar().map((i) => i.id)).toEqual(["b"]);
    handle.dispose();
    expect(p.statusBar()).toEqual([]);
    ctx.statusBar.set("b", { text: "again" });
    await p.disable();
    expect(p.statusBar()).toEqual([]);
    await p.dispose();
  });
});
