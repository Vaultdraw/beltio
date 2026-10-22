// focus-timer: a small Pomodoro-style timer.
// Shows a panel (React hooks, no build step) declared in plugin.toml, a command
// that opens that panel with ctx.panels.open, timers created through ctx so
// disable leaves nothing running, an int setting with bounds, and "work only
// while visible": with the panel closed the plugin holds exactly one timeout
// (the end of the session); the 1 s redraw interval lives in the panel
// component, exists only while the panel is mounted and a session runs, and is
// disposed on unmount.
import {
  createElement as h,
  useEffect,
  useReducer,
  useSyncExternalStore,
} from "react";
import { definePlugin } from "@vaultdraw/api";

const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

export default definePlugin({
  activate(ctx) {
    // Tiny store: endsAt (ms timestamp) or null when idle.
    let endsAt = null;
    let ending = null;
    const listeners = new Set();
    const set = (value) => {
      endsAt = value;
      listeners.forEach((l) => l());
    };
    const store = {
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      get: () => endsAt,
    };

    const stop = () => {
      ending?.dispose();
      ending = null;
      set(null);
    };
    const start = () => {
      ending?.dispose();
      const ms = ctx.settings.get("minutes") * 60_000;
      ending = ctx.setTimeout(() => {
        ending = null;
        set(null);
        ctx.ui.toast("Focus session done");
      }, ms);
      set(Date.now() + ms);
    };

    function Timer() {
      const end = useSyncExternalStore(store.subscribe, store.get);
      const [, redraw] = useReducer((n) => n + 1, 0);
      const running = end !== null;
      useEffect(() => {
        if (!running) {
          return undefined;
        }
        const tick = ctx.setInterval(redraw, 1000);
        return () => tick.dispose();
      }, [running]);
      return h(
        "div",
        { className: "focus-timer", style: { padding: 16 } },
        h(
          "div",
          {
            role: "timer",
            "data-testid": "focus-timer-remaining",
            style: { fontSize: 32 },
          },
          running
            ? clock(end - Date.now())
            : clock(ctx.settings.get("minutes") * 60_000),
        ),
        h(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 12 } },
          h(
            "button",
            { type: "button", onClick: start },
            running ? "Restart" : "Start",
          ),
          h(
            "button",
            { type: "button", onClick: stop, disabled: !running },
            "Stop",
          ),
        ),
      );
    }

    ctx.panels.register("timer", Timer);
    ctx.commands.register("start", () => {
      start();
      ctx.panels.open("timer");
    });
    ctx.commands.register("stop", stop);
  },
});
