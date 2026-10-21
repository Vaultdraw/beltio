import { createElement as h, useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);
  return h(
    "div",
    { className: "e2e-counter", style: { padding: 12 } },
    h("span", { "data-testid": "count" }, `Count: ${count}`),
    h("button", { onClick: () => setCount((c) => c + 1) }, "Increment"),
  );
}

export default {
  activate(ctx) {
    ctx.panels.register("counter", Counter);
  },
};
