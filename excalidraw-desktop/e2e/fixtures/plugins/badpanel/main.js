import { createElement as h } from "react";

function Bad() {
  throw new Error("panel exploded");
}
function Good() {
  return h("div", { "data-testid": "good-panel" }, "Good panel");
}

export default {
  activate(ctx) {
    ctx.panels.register("bad", Bad);
    ctx.panels.register("good", Good);
    ctx.commands.register("hi", () => ctx.ui.toast("hi from badpanel"));
  },
};
