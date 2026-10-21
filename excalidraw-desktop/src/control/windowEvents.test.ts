import { describe, expect, it, vi } from "vitest";

import { createTabStore } from "../tabs/tabStore";
import { activate, initialState, openPath } from "../tabs/tabsModel";
import { onCommandRan, runHandler } from "../commands/dispatcher";

import { tabListResult } from "./tabList";
import { createWindowEvents } from "./windowEvents";

const setup = () => {
  const store = createTabStore(initialState());
  const publish = vi.fn();
  const frames: (() => void)[] = [];
  const subscribeSpy = vi.spyOn(store, "subscribe");
  const events = createWindowEvents({
    publish,
    onCommandRan,
    tabList: () => tabListResult(store.getState(), null),
    schedule: (cb) => {
      frames.push(cb);
      return () => {};
    },
  });
  events.setTabStore(store);
  const flush = () => frames.splice(0).forEach((f) => f());
  return { store, publish, events, frames, flush, subscribeSpy };
};

describe("window events", () => {
  it("attaches nothing while no topic is wanted", () => {
    const { store, publish, events, frames, subscribeSpy } = setup();
    events.setTopics([]);
    store.update((s) => ({ ...s, nextId: s.nextId + 1 }));
    events.activePathChanged("a.excalidraw");
    runHandler("x", () => {});
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("tab topic: attach, coalesce to one publish per frame, skip unchanged, detach", () => {
    const { store, publish, events, frames, flush } = setup();
    events.setTopics(["tab"]);
    const change = (path: string) =>
      store.update((s) => openPath(s, path, { target: "new", focus: true }));
    change("a.excalidraw");
    change("b.excalidraw");
    expect(frames).toHaveLength(1);
    flush();
    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, name, data] = publish.mock.calls[0];
    expect([topic, name]).toEqual(["tab", "tab.changed"]);
    expect(data.tabs.map((t: any) => t.path)).toContain("b.excalidraw");
    expect(Object.keys(data)).toEqual(["tabs", "activeId"]);

    // A state change that serializes identically publishes nothing.
    store.update((s) => ({ ...s }));
    flush();
    expect(publish).toHaveBeenCalledTimes(1);

    events.setTopics([]);
    store.update((s) => activate(s, s.tabs[0].id));
    expect(frames).toHaveLength(0);
  });

  it("re-attaches to a new store", () => {
    const { events, publish } = setup();
    events.setTopics(["tab"]);
    const other = createTabStore(initialState());
    const spy = vi.spyOn(other, "subscribe");
    events.setTabStore(other);
    expect(spy).toHaveBeenCalledTimes(1);
    events.setTabStore(null);
    expect(publish).not.toHaveBeenCalled();
  });

  it("file topic publishes file.opened for a path only", () => {
    const { events, publish } = setup();
    events.setTopics(["file"]);
    events.activePathChanged("a.excalidraw");
    events.activePathChanged(null);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("file", "file.opened", {
      path: "a.excalidraw",
    });
  });

  it("command topic: listens only while wanted, payload {id}", () => {
    const { events, publish } = setup();
    runHandler("c.none", () => {});
    expect(publish).not.toHaveBeenCalled();
    events.setTopics(["command"]);
    runHandler("c.one", () => {});
    expect(publish).toHaveBeenCalledWith("command", "command.ran", {
      id: "c.one",
    });
    events.setTopics(["file"]);
    runHandler("c.two", () => {});
    expect(publish).toHaveBeenCalledTimes(1);
    events.setTopics(["command"]);
    events.dispose();
    runHandler("c.three", () => {});
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("a failing handler is not reported as ran", () => {
    const { events, publish } = setup();
    events.setTopics(["command"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    runHandler("bad", () => {
      throw new Error("x");
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
