/**
 * Window-side event publishers (C3). Listeners exist only while Rust says a
 * topic is wanted ("control_ready" result, "control-topics" event); with no
 * subscriber nothing is attached, scheduled or computed.
 */
import type { TabStore } from "../tabs/tabStore";
import type { TabListResult } from "./tabList";

export type WindowTopic = "file" | "tab" | "command";

export interface WindowEventsDeps {
  publish: (topic: WindowTopic, name: string, data: unknown) => void;
  onCommandRan: (cb: (id: string) => void) => () => void;
  tabList: () => TabListResult;
  /** Runs `cb` soon (one animation frame); returns a cancel function. */
  schedule: (cb: () => void) => () => void;
}

export interface WindowEvents {
  setTopics: (topics: readonly string[]) => void;
  /** The tab store changed (vault switch, tabs toggled). */
  setTabStore: (store: TabStore | null) => void;
  /** The active drawing path changed (null = none). */
  activePathChanged: (path: string | null) => void;
  dispose: () => void;
}

export function createWindowEvents(deps: WindowEventsDeps): WindowEvents {
  const wanted = new Set<string>();
  let store: TabStore | null = null;
  let tabOff: (() => void) | null = null;
  let tabStoreAttached: TabStore | null = null;
  let cancelFrame: (() => void) | null = null;
  let lastTabs = "";
  let commandOff: (() => void) | null = null;

  const flushTabs = () => {
    cancelFrame = null;
    const list = deps.tabList();
    const json = JSON.stringify(list);
    if (json !== lastTabs) {
      lastTabs = json;
      deps.publish("tab", "tab.changed", list);
    }
  };

  const detachTabs = () => {
    tabOff?.();
    tabOff = null;
    tabStoreAttached = null;
    cancelFrame?.();
    cancelFrame = null;
  };

  const syncTabs = () => {
    const want = wanted.has("tab") && store !== null;
    if (!want || tabStoreAttached !== store) {
      detachTabs();
    }
    if (want && !tabOff && store) {
      lastTabs = JSON.stringify(deps.tabList());
      tabStoreAttached = store;
      tabOff = store.subscribe(() => {
        cancelFrame ??= deps.schedule(flushTabs);
      });
    }
  };

  const syncCommands = () => {
    if (wanted.has("command") && !commandOff) {
      commandOff = deps.onCommandRan((id) =>
        deps.publish("command", "command.ran", { id }),
      );
    } else if (!wanted.has("command") && commandOff) {
      commandOff();
      commandOff = null;
    }
  };

  return {
    setTopics(topics) {
      wanted.clear();
      topics.forEach((t) => wanted.add(t));
      syncTabs();
      syncCommands();
    },
    setTabStore(next) {
      store = next;
      if (wanted.has("tab")) {
        syncTabs();
      }
    },
    activePathChanged(path) {
      if (path !== null && wanted.has("file")) {
        deps.publish("file", "file.opened", { path });
      }
    },
    dispose() {
      wanted.clear();
      detachTabs();
      syncCommands();
    },
  };
}
