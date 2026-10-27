// status-clock: a status bar item.
// The item is declared in plugin.toml and filled with ctx.statusBar.set. A click
// runs the declared command, which is also in the palette. The plugin keeps one
// interval (every 15 s, every second while seconds are shown); disabling the
// plugin clears it and removes the item.
import { definePlugin } from "@vaultdraw/api";

const pad = (n) => String(n).padStart(2, "0");

export default definePlugin({
  activate(ctx) {
    let seconds = false;
    let tick = null;
    const draw = () => {
      const d = new Date();
      const text = `${pad(d.getHours())}:${pad(d.getMinutes())}${
        seconds ? `:${pad(d.getSeconds())}` : ""
      }`;
      ctx.statusBar.set("clock", { text, tooltip: "Click to toggle seconds" });
    };
    const schedule = () => {
      tick?.dispose();
      tick = ctx.setInterval(draw, seconds ? 1000 : 15000);
    };
    ctx.commands.register("toggle-seconds", () => {
      seconds = !seconds;
      draw();
      schedule();
    });
    draw();
    schedule();
  },
});
