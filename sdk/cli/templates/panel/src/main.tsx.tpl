// A panel (a React component) and a command that opens it. The panel's code runs
// only while the panel is mounted. React is provided by the app: import it, do not bundle it.
import { useState } from "react";
import type { Plugin } from "@vaultdraw/api";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 16 }}>
      <p data-testid="count">Clicked {count} times</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Click me
      </button>
    </div>
  );
}

const plugin: Plugin = {
  activate(ctx) {
    ctx.panels.register("main", Counter);
    ctx.commands.register("open", () => {
      ctx.panels.open("main");
    });
  },
};

export default plugin;
