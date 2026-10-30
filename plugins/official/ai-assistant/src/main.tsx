/**
 * ai-assistant: ask a model you choose about the drawing, with your own key. Off until you turn it
 * on in Settings, Plugins. Nothing loads before that. Requests are sent by the app (`ctx.net`), the
 * key is kept by the app (`ctx.secret`) and cannot be read back, and Offline mode is respected.
 */
import { definePlugin } from "@vaultdraw/api";

import css from "./ai.css";
import Panel from "./Panel";
import { createSession } from "./session";

import type { Task } from "./prompts";

export default definePlugin({
  activate(ctx) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    ctx.subscriptions.push({ dispose: () => style.remove() });

    const session = createSession(ctx);
    ctx.panels.register("assistant", () => <Panel session={session} />);

    const open = (task: Task, target?: "key") => {
      ctx.panels.open("assistant");
      session.setTask(task, target);
    };

    ctx.commands.register("ask", () => open("ask"));
    ctx.commands.register("describe", () => {
      open("describe");
      void session.run("describe", "");
    });
    ctx.commands.register("diagram", () => open("diagram"));
    ctx.commands.register("summarise", () => {
      open("summarise");
      void session.run("summarise", "");
    });
    ctx.commands.register("cancel", () => session.cancel());
    ctx.commands.register("set-key", () => open(session.get().task, "key"));
    ctx.commands.register("remove-key", async () => {
      await session.removeKey();
      ctx.ui.toast("API key removed");
    });
    ctx.commands.register("clear", () => session.clear());
    ctx.subscriptions.push({ dispose: () => session.cancel() });
  },
});
