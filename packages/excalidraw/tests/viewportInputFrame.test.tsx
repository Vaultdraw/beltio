import React from "react";
import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { Excalidraw } from "../index";
import { flushPendingViewportInput } from "../components/App.viewport";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { GlobalTestState, render } from "./test-utils";

const { h } = window;

// throttleRAF runs synchronously under the test setup; here frames are held
// until the test releases them, like a real display between two vsyncs
const frames = vi.hoisted(() => {
  const pending = new Set<() => void>();
  return {
    pending,
    release: () => {
      const due = [...pending];
      pending.clear();
      due.forEach((frame) => frame());
    },
  };
});

vi.mock("@excalidraw/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@excalidraw/common")>();
  const throttleRAF = <T extends unknown[]>(fn: (...args: T) => void) => {
    let lastArgs: T | null = null;
    const frame = () => {
      const args = lastArgs;
      lastArgs = null;
      if (args) {
        fn(...args);
      }
    };
    const ret = (...args: T) => {
      lastArgs = args;
      frames.pending.add(frame);
    };
    ret.flush = () => {
      frames.pending.delete(frame);
      frame();
    };
    ret.cancel = () => {
      frames.pending.delete(frame);
      lastArgs = null;
    };
    return ret;
  };
  return { ...actual, throttleRAF };
});

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

const wheel = (init: WheelEventInit) =>
  fireEvent.wheel(GlobalTestState.interactiveCanvas, init);

const viewport = () => ({
  scrollX: h.state.scrollX,
  scrollY: h.state.scrollY,
  zoom: h.state.zoom.value,
});

describe("viewport input lands once per frame", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
    act(() => frames.release());
    renderStaticScene.mockClear();
  });

  it("applies every wheel tick of a frame in one commit and one static draw", () => {
    const start = viewport();

    wheel({ deltaX: 10, deltaY: 20 });
    wheel({ deltaX: 5, deltaY: 5 });
    wheel({ deltaY: -50, ctrlKey: true });
    // nothing changes before the frame: the state is what is on screen
    expect(viewport()).toEqual(start);
    expect(renderStaticScene).not.toHaveBeenCalled();

    act(() => frames.release());

    expect(renderStaticScene).toHaveBeenCalledTimes(1);
    expect(h.state.zoom.value).toBeGreaterThan(start.zoom);
    expect(h.state.shouldCacheIgnoreZoom).toBe(true);
  });

  it("pans by the sum of a frame's ticks", () => {
    const start = viewport();
    wheel({ deltaX: 10, deltaY: 20 });
    wheel({ deltaX: 5, deltaY: 5 });
    act(() => frames.release());
    expect(viewport()).toEqual({
      ...start,
      scrollX: start.scrollX - 15,
      scrollY: start.scrollY - 25,
    });
  });

  it("flushPendingViewportInput applies the held input now", () => {
    const start = viewport();
    wheel({ deltaX: 10 });
    act(() => flushPendingViewportInput());
    expect(viewport().scrollX).toBe(start.scrollX - 10);
  });

  it("drops held input when a scene sets the viewport", () => {
    wheel({ deltaX: 10 });
    act(() => {
      API.updateScene({ appState: { scrollX: 123, scrollY: 45 } });
    });
    act(() => frames.release());
    expect(viewport().scrollX).toBe(123);
    expect(viewport().scrollY).toBe(45);
  });
});
