// event-logger: logs the app events (vault.opened, drawing.opened/saved/
// renamed/deleted) into a ring buffer shown in a panel, newest first.
// Shows disposal: everything registered through ctx (events.on,
// settings.onChange, panels, commands) is disposed by the host on
// disable/reload/quit, so nothing is left listening. Keep the returned
// Disposable only to unsubscribe early. activation is
// onStartupFinished so events from startup on are seen; activate() only
// subscribes and registers. No timers.
import { createElement as h, useSyncExternalStore } from "react";
import { definePlugin } from "@vaultdraw/api";

const EVENTS = [
  "vault.opened",
  "drawing.opened",
  "drawing.saved",
  "drawing.renamed",
  "drawing.deleted",
];

const describe = (name, p) =>
  name === "drawing.renamed"
    ? `${p.from} → ${p.to}`
    : name === "vault.opened"
    ? p.name
    : p.path;

export default definePlugin({
  activate(ctx) {
    // Tiny store: an immutable array (oldest first), replaced on every change.
    let entries = [];
    let seq = 0; // stable React keys
    const listeners = new Set();
    const set = (next) => {
      entries = next;
      listeners.forEach((l) => l());
    };
    const store = {
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      get: () => entries,
    };
    const limit = () => ctx.settings.get("max");
    const clear = () => set([]);

    const record = (name, payload) => {
      const entry = {
        seq: ++seq,
        at: Date.now(),
        name,
        detail: describe(name, payload),
      };
      set([...entries, entry].slice(-limit()));
    };
    for (const name of EVENTS) {
      ctx.events.on(name, (p) => record(name, p));
    }
    ctx.settings.onChange("max", () => set(entries.slice(-limit())));

    function Log() {
      const list = useSyncExternalStore(store.subscribe, store.get);
      return h(
        "div",
        { className: "event-log", style: { padding: 16 } },
        h(
          "button",
          { type: "button", onClick: clear, disabled: list.length === 0 },
          "Clear",
        ),
        list.length === 0
          ? h("p", { "data-testid": "event-log-empty" }, "No events yet")
          : h(
              "ul",
              {
                "data-testid": "event-log-list",
                style: {
                  listStyle: "none",
                  padding: 0,
                  fontFamily: "monospace",
                },
              },
              [...list]
                .reverse()
                .map((e) =>
                  h(
                    "li",
                    { key: e.seq },
                    `${new Date(e.at).toLocaleTimeString()}  ${e.name}  ${
                      e.detail
                    }`,
                  ),
                ),
            ),
      );
    }

    ctx.panels.register("log", Log);
    ctx.commands.register("clear", clear);
  },
});
