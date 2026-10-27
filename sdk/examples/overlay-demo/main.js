// overlay-demo: a view that covers the drawing area (ctx.overlays.open).
// Nothing to declare: the command is the entry point, so the plugin loads on first use.
// Opening again while it is shown closes it. Esc and the button call close() too.
import { createElement as h } from "react";

import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    let shown = null;
    ctx.commands.register("toggle", () => {
      if (shown?.isOpen) {
        shown.close();
        return;
      }
      shown = ctx.overlays.open(({ close }) =>
        h(
          "div",
          { style: { padding: 24 } },
          h("p", null, "Hello from an overlay"),
          h("button", { onClick: close }, "Close"),
        ),
      );
    });
  },
});
