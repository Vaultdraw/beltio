import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  boot,
  type TestPlugin,
} from "../../../excalidraw-desktop/src/plugins/testing";
import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(async () => {
  await p?.dispose();
  p = undefined;
  vi.useRealTimers();
});

const lines = () =>
  screen.queryAllByRole("listitem").map((li) =>
    // drop the leading time of day
    li.textContent!.replace(/^.*?\s{2}(?=\S+\s{2})/, ""),
  );

const emit: TestPlugin["events"]["emit"] = (name, payload) =>
  act(() => p!.events.emit(name, payload));

const start = async () => {
  p = await boot(readExample("event-logger"), plugin);
  return p;
};

describe("event-logger", () => {
  it("activates at startup without any user action", async () => {
    const activate = vi.spyOn(plugin, "activate");
    await start();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(p!.timers()).toBe(0);
  });

  it("lists events newest first with readable text", async () => {
    await start();
    await p!.openPanel("log");
    expect(screen.getByTestId("event-log-empty")).toBeTruthy();

    emit("vault.opened", { name: "Notes" });
    emit("drawing.opened", { path: "a.excalidraw" });
    emit("drawing.saved", { path: "a.excalidraw" });
    emit("drawing.renamed", {
      from: "a.excalidraw",
      to: "b.excalidraw",
    });
    emit("drawing.deleted", { path: "b.excalidraw" });
    await p!.flush();
    expect(lines()).toEqual([
      "drawing.deleted  b.excalidraw",
      "drawing.renamed  a.excalidraw → b.excalidraw",
      "drawing.saved  a.excalidraw",
      "drawing.opened  a.excalidraw",
      "vault.opened  Notes",
    ]);
  });

  it("keeps the last `max` entries and trims when the setting shrinks", async () => {
    await start();
    await p!.setSetting("max", 10);
    await p!.openPanel("log");
    for (let i = 0; i < 15; i++) {
      emit("drawing.saved", { path: `d${i}.excalidraw` });
    }
    await p!.flush();
    expect(lines()).toHaveLength(10);
    expect(lines()[0]).toBe("drawing.saved  d14.excalidraw");
    expect(lines()[9]).toBe("drawing.saved  d5.excalidraw");
  });

  it("trims existing entries when `max` is lowered", async () => {
    await start();
    await p!.openPanel("log");
    for (let i = 0; i < 30; i++) {
      emit("drawing.saved", { path: `d${i}.excalidraw` });
    }
    await p!.flush();
    expect(lines()).toHaveLength(30);
    await act(() => p!.setSetting("max", 10));
    await p!.flush();
    expect(lines()).toHaveLength(10);
    expect(lines()[0]).toBe("drawing.saved  d29.excalidraw");
  });

  it("Clear button and the command empty the log", async () => {
    await start();
    await p!.openPanel("log");
    emit("drawing.opened", { path: "a.excalidraw" });
    await p!.flush();
    expect(lines()).toHaveLength(1);
    await act(async () =>
      screen.getByRole("button", { name: "Clear" }).click(),
    );
    await p!.flush();
    expect(screen.getByTestId("event-log-empty")).toBeTruthy();

    emit("drawing.opened", { path: "b.excalidraw" });
    await p!.flush();
    expect(lines()).toHaveLength(1);
    await p!.run("clear");
    await p!.flush();
    expect(screen.getByTestId("event-log-empty")).toBeTruthy();
  });

  it("after disable() events do nothing: no errors, no growth, no timers", async () => {
    await start();
    await p!.openPanel("log");
    emit("drawing.opened", { path: "a.excalidraw" });
    await p!.flush();
    expect(lines()).toHaveLength(1);

    await p!.disable();
    emit("drawing.opened", { path: "b.excalidraw" });
    emit("vault.opened", { name: "X" });
    await p!.flush();
    expect(p!.log().filter((l) => l.level === "error")).toEqual([]);
    expect(p!.timers()).toBe(0);
    // The panel is gone; re-enabling starts from an empty log, not a grown one.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
