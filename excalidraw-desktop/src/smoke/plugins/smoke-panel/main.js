import { createElement as h, useState } from "react";
import { definePlugin } from "@vaultdraw/api";

function Counter() {
  const [n, setN] = useState(0);
  return h(
    "button",
    { "data-smoke-counter": String(n), onClick: () => setN(n + 1) },
    `count ${n}`,
  );
}

export default definePlugin({
  activate(ctx) {
    ctx.panels.register("counter", Counter);
  },
});
