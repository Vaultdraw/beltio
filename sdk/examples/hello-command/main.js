// hello-command: the smallest useful plugin.
// Shows a command declared in plugin.toml and bound in activate(), a default
// hotkey, a setting read at run time, and a setting change listener.
// Nothing here loads until the command first runs.
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => {
      ctx.ui.toast(`${ctx.settings.get("greeting")}, Vaultdraw!`);
    });

    // Disposed by the host on disable, like everything registered through ctx.
    ctx.settings.onChange("greeting", (value) => {
      ctx.log.info("greeting is now", value);
    });
  },
});
