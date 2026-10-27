import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { BUILTIN_COMMANDS } from "../src/commands/commands";
import { readContext } from "../src/commands/context";
import { installCommandDispatcher } from "../src/commands/dispatcher";
import {
  getRegisteredHandler,
  registerCommandHandlers,
} from "../src/commands/handlerRegistry";
import { buildKeymap } from "../src/commands/keymap";
import "../src/components/VaultShell.css";
import { officialCommandDefs } from "../src/plugins/boot";
import { OFFICIAL_PLUGINS } from "../src/plugins/officialPlugins";
import { fakeGraph } from "../../plugins/official/graph/src/fakeGraph";
import { GRAPH_VIEW_IDS } from "../../plugins/official/graph/src/commandIds";
import { runViewCommand } from "../../plugins/official/graph/src/viewBus";
import { DEFAULT_GRAPH_SETTINGS } from "../../plugins/official/graph/src/settings";

import type {
  GraphSession,
  GraphSource,
} from "../../plugins/official/graph/src/GraphSession";
import type {
  GraphMode,
  GraphSettings,
} from "../../plugins/official/graph/src/settings";

/**
 * Graph e2e/perf harness (`e2e.html?graph=N`): mounts the real GraphView over `fakeGraph(N)` and
 * an in-memory layout store, no Rust. Params: `graph=N` (nodes), `canvas2d=1` (skip WebGL),
 * `theme=dark`, `mode=local`, `warm=1` (open once, settle, reopen warm), `shown=0` (start closed).
 * Test hooks on `window.__graph`: `opened` (paths), `closed` (count), `toggle()`, `layout`
 * (saved bytes), `metrics()` (session metrics of the latest open), `settings`.
 */
export interface GraphHarnessHooks {
  opened: string[];
  closed: number;
  toggle: () => void;
  layout: Uint8Array | null;
  saves: number;
  graphMs: number;
  /** The open session (metrics, node picking); null while closed. */
  session: GraphSession | null;
}

declare global {
  interface Window {
    __graph?: GraphHarnessHooks;
    __graphSettings?: GraphSettings;
  }
}

export function mountGraphHarness(root: HTMLElement, params: URLSearchParams) {
  const n = Math.max(1, Number(params.get("graph")) || 1000);
  const forceCanvas2d = params.get("canvas2d") === "1";
  const hooks: GraphHarnessHooks = {
    opened: [],
    closed: 0,
    toggle: () => undefined,
    layout: null,
    saves: 0,
    graphMs: 0,
    session: null,
  };
  window.__graph = hooks;

  // No app shell here: the real dispatcher with the built-in keymap, so the
  // graph.* keys reach the view as they do in the app.
  const keymap = buildKeymap(
    [
      ...BUILTIN_COMMANDS,
      ...officialCommandDefs(OFFICIAL_PLUGINS.find((p) => p.id === "graph")!),
    ],
    {},
    "linux",
  );
  // The plugin registers these through ctx.commands; here they run the mounted view's actions.
  registerCommandHandlers(
    Object.fromEntries(
      GRAPH_VIEW_IDS.map((id) => [id, () => void runViewCommand(id)]),
    ),
  );
  installCommandDispatcher(window, {
    platform: "linux",
    getKeymap: () => keymap,
    getContext: () =>
      readContext(document, {
        vaultOpen: true,
        drawingOpen: true,
        writable: true,
      }),
    getHandler: getRegisteredHandler,
  });

  let cached: ReturnType<typeof fakeGraph> | null = null;
  const getGraph = () => {
    if (!cached) {
      const t = performance.now();
      cached = fakeGraph(n);
      hooks.graphMs = performance.now() - t;
    }
    return cached;
  };
  const source: GraphSource = {
    graph: async () => getGraph(),
    loadLayout: async () => hooks.layout ?? new Uint8Array(0),
    saveLayout: async (_h, bytes) => {
      hooks.layout = bytes;
      hooks.saves++;
    },
  };

  const path = (() => {
    const g = getGraph();
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (g.outDeg[i] + g.inDeg[i] > g.outDeg[best] + g.inDeg[best]) {
        best = i;
      }
    }
    return g.path(best);
  })();

  function Harness({
    GraphView,
  }: {
    GraphView: typeof import("../../plugins/official/graph/src/GraphView").default;
  }) {
    const [shown, setShown] = useState(params.get("shown") !== "0");
    const [mode, setMode] = useState<GraphMode>(
      params.get("mode") === "local" ? "local" : "global",
    );
    const [settings, setSettings] = useState<GraphSettings>(
      DEFAULT_GRAPH_SETTINGS,
    );
    const [themeKey, setThemeKey] = useState("t0");
    useEffect(() => {
      window.__graphSettings = settings;
    }, [settings]);
    const toggle = useCallback(() => setShown((v) => !v), []);
    useEffect(() => {
      hooks.toggle = toggle;
      (
        window as unknown as { __graphTheme: (dark: boolean) => void }
      ).__graphTheme = (dark) => {
        document.documentElement.classList.toggle("dark", dark);
        setThemeKey(dark ? "dark" : "light");
      };
    }, [toggle]);
    const stub = useMemo(() => ({ source, forceCanvas2d }), []);
    return shown ? (
      <div style={{ position: "fixed", inset: 0 }}>
        <GraphView
          {...stub}
          onSession={(s) => {
            hooks.session = s;
          }}
          handle="harness"
          currentPath={path}
          mode={mode}
          onModeChange={setMode}
          settings={settings}
          onSettingsChange={setSettings}
          onOpen={(p) => {
            hooks.opened.push(p);
          }}
          onClose={() => {
            hooks.closed++;
            setShown(false);
          }}
          shortcutFor={(p) => (p === path ? "Ctrl+Alt+1" : null)}
          themeKey={themeKey}
        />
      </div>
    ) : (
      <button data-testid="reopen" onClick={toggle}>
        reopen
      </button>
    );
  }

  void import("../../plugins/official/graph/src/GraphView").then(
    ({ default: GraphView }) => {
      createRoot(root).render(
        <StrictMode>
          <Harness GraphView={GraphView} />
        </StrictMode>,
      );
    },
  );
}
