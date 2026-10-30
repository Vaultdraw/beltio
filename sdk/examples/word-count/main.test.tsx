import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin, { stats } from "./main.js";

const ID = "word-count";
let t: TestPlugin | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

/** The real plugin, with counters on activation, selector runs and panel renders. */
const probes = { activations: 0, selects: 0, renders: 0 };
const instrumented = {
  activate(ctx: any) {
    probes.activations++;
    const useScene = ctx.scene.useScene;
    const wrapped = {
      ...ctx,
      scene: {
        ...ctx.scene,
        useScene: (sel: any, eq: any) =>
          useScene((els: any) => {
            probes.selects++;
            return sel(els);
          }, eq),
      },
      panels: {
        ...ctx.panels,
        register: (id: string, C: any) =>
          ctx.panels.register(id, (props: any) => {
            probes.renders++;
            return C(props);
          }),
      },
    };
    return (plugin as any).activate(wrapped);
  },
};

const start = async () => {
  probes.activations = probes.selects = probes.renders = 0;
  t = await boot(readExample(ID) as never, instrumented as never);
  return t;
};
const stat = (k: string) => screen.getByTestId(`stat-${k}`).textContent;

const text = (id: string, s: string) =>
  ({ id, type: "text", text: s, x: 0, y: 0, width: 50, height: 20 } as const);
const rect = (id: string) =>
  ({ id, type: "rectangle", x: 0, y: 0, width: 50, height: 20 } as const);

describe("stats()", () => {
  it("counts words (Unicode, contractions, CJK), characters and kinds", () => {
    const els = [
      { type: "text", text: "Don't panic, état-civil 42" },
      { type: "text", text: "日本語 ok" },
      { type: "rectangle", text: "label here" },
      { type: "ellipse" },
      { type: "arrow" },
      { type: "line" },
      { type: "freedraw" },
    ] as never[];
    expect(stats(els)).toEqual({
      words: 4 + 4 + 2,
      characters: 23 + 5 + 9,
      texts: 2,
      shapes: 2,
      lines: 2,
      total: 7,
    });
    expect(stats([]).words).toBe(0);
  });
});

describe("word-count plugin", () => {
  it("loads nothing before use", async () => {
    await start();
    t!.scene.setElements([text("a", "one two")]);
    await t!.flush();
    expect(probes.activations).toBe(0);
    expect(t!.timers()).toBe(0);
  });

  it("the panel shows counts and updates after a scene edit", async () => {
    await start();
    await t!.openPanel("stats");
    expect(screen.getByTestId("stats-empty")).toBeTruthy();

    t!.scene.setElements([text("a", "hello big world"), rect("r")]);
    await t!.flush();
    expect(stat("words")).toBe("3");
    expect(stat("texts")).toBe("1");
    expect(stat("shapes")).toBe("1");
    expect(stat("total")).toBe("2");

    t!.scene.setElements([
      text("a", "hello big world"),
      text("b", "again"),
      rect("r"),
    ]);
    await t!.flush();
    expect(stat("words")).toBe("4");
    expect(stat("total")).toBe("3");
  });

  it("an edit that leaves the counts alone does not re-render", async () => {
    await start();
    t!.scene.setElements([text("a", "one two"), rect("r")]);
    await t!.openPanel("stats");
    expect(stat("words")).toBe("2");
    const renders = probes.renders;
    const selects = probes.selects;

    t!.scene.emitChange();
    await t!.flush();
    expect(probes.selects).toBeGreaterThan(selects); // the pass ran...
    expect(probes.renders).toBe(renders); // ...but isEqual kept the render count
  });

  it("a closed panel does no work on scene changes", async () => {
    await start();
    const view = await t!.openPanel("stats");
    t!.scene.setElements([text("a", "one two")]);
    await t!.flush();
    view.unmount();
    const selects = probes.selects;

    t!.scene.setElements([text("a", "one two three"), rect("r")]);
    await t!.flush();
    t!.scene.emitChange();
    await t!.flush();
    expect(probes.selects).toBe(selects);
  });

  it("the command toasts the word count read on demand", async () => {
    await start();
    t!.scene.setElements([text("a", "one two"), text("b", "three")]);
    await t!.run("count");
    expect(t!.toasts()).toEqual(["Word count: 3 words"]);
    expect(probes.selects).toBe(0);
  });

  it("disable leaves no timers and no scene work", async () => {
    await start();
    const view = await t!.openPanel("stats");
    t!.scene.setElements([text("a", "one two")]);
    await t!.flush();
    view.unmount();
    await t!.disable();
    const selects = probes.selects;
    t!.scene.emitChange();
    await t!.flush();
    expect(t!.timers()).toBe(0);
    expect(probes.selects).toBe(selects);
    expect(t!.log().filter((l) => l.level === "error")).toEqual([]);
  });
});
