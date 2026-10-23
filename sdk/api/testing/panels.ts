import type { ComponentType, ReactElement, ReactNode } from "react";
import type * as ReactNS from "react";
import type * as RtlNS from "@testing-library/react";

/** The React hooks the mock's `scene.useScene` needs. */
export type Hooks = Pick<
  typeof ReactNS,
  "useCallback" | "useRef" | "useSyncExternalStore"
>;

/** React and Testing Library, loaded only for plugins that declare a panel. */
export interface PanelDeps {
  react: typeof ReactNS;
  rtl: typeof RtlNS;
}

/** Loads the optional packages; a clear error when they are missing. */
export async function loadPanelDeps(): Promise<PanelDeps> {
  try {
    const [react, rtl] = await Promise.all([
      import("react"),
      import("@testing-library/react"),
    ]);
    return { react, rtl };
  } catch (err) {
    throw new Error(
      `not set up in this test: panels need the packages "react", "react-dom" and "@testing-library/react" (npm install --save-dev react react-dom @testing-library/react): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** What the panels root reads from the host. */
export interface PanelSource {
  pluginId: string;
  /** Short ids of the open panels. */
  open(): readonly string[];
  /** Changes whenever a panel opens, closes or registers a component. */
  version(): number;
  subscribe(cb: () => void): () => void;
  component(short: string): ComponentType | undefined;
  title(short: string): string;
  /** A render error, attributed to the plugin. */
  report(err: unknown): void;
}

/** The element that renders every open panel, like the app's panels host. */
export function panelsRoot(deps: PanelDeps, src: PanelSource): ReactElement {
  const {
    createElement: h,
    Component,
    Fragment,
    useSyncExternalStore,
  } = deps.react;

  class Boundary extends Component<
    { children?: ReactNode },
    { failed: boolean }
  > {
    state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error: Error) {
      src.report(error);
    }

    render() {
      return this.state.failed
        ? h("div", { role: "alert" }, "This plugin panel crashed.")
        : this.props.children;
    }
  }

  function Panels() {
    useSyncExternalStore(src.subscribe, src.version);
    return h(
      Fragment,
      null,
      src.open().flatMap((short) => {
        const C = src.component(short);
        return C
          ? [
              h(
                "aside",
                {
                  key: short,
                  "data-testid": `plugin-panel-${src.pluginId}.${short}`,
                  "aria-label": src.title(short),
                },
                h(Boundary, null, h(C)),
              ),
            ]
          : [];
      }),
    );
  }

  return h(Panels);
}
