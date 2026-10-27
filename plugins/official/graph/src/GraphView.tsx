/**
 * The graph view (lazy chunk): toolbar, stage with the GPU canvas and the label overlay, hover
 * card, hint badges and the Vim key handling. All engine work lives in GraphSession.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GRAPH_COMMAND_IDS, GRAPH_VIEW_COMMAND_IDS } from "./commandIds";
import { type GraphSession, type GraphSource } from "./GraphSession";
import { GraphToolbar } from "./GraphToolbar";
import { HoverCard } from "./HoverCard";
import { resolveHint, type HintMap } from "./hints";
import { type Direction } from "./keyboard";
import { resetDisplayAndForces, SettingsPanel } from "./SettingsPanel";
import { useGraphSession } from "./useGraphSession";
import { useViewCommands } from "./viewBus";

import graphCss from "./graph.css?raw";

import type { GraphViewProps } from "./settings";

export interface GraphViewExtraProps {
  /** Where the graph and its layout cache come from. */
  source: GraphSource;
  /** Tests / e2e: skip WebGL. */
  forceCanvas2d?: boolean;
  /** Tests / e2e: receives the live session once the graph is ready (null on close). */
  onSession?: (session: GraphSession | null) => void;
  /** Bump to refit the camera to the graph (the `graph.fit` command). */
  fitNonce?: number;
}

type HintState = {
  map: HintMap;
  typed: string;
  at: Map<number, { x: number; y: number }>;
};

const ZOOM_STEP = 1.25;

/** Adds the plugin's stylesheet to the document while the view is mounted. */
function useStyle(ref: React.RefObject<HTMLElement | null>, css: string) {
  useLayoutEffect(() => {
    const doc = ref.current?.ownerDocument ?? document;
    const style = doc.createElement("style");
    style.dataset.pluginStyle = "graph";
    style.textContent = css;
    doc.head.appendChild(style);
    return () => style.remove();
  }, [ref, css]);
}

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export default function GraphView(props: GraphViewProps & GraphViewExtraProps) {
  const { settings, mode, onClose, onOpen } = props;
  const { source } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hints, setHints] = useState<HintState | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  const inputs = useMemo(
    () => ({
      mode,
      currentPath: props.currentPath,
      settings,
      themeKey: props.themeKey,
    }),
    [mode, props.currentPath, settings, props.themeKey],
  );
  const { stageRef, overlayRef, sessionRef, state, shown } = useGraphSession({
    handle: props.handle,
    source,
    inputs,
    forceCanvas2d: props.forceCanvas2d,
    onOpen,
    onInteract: () => setHints(null),
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  const { onSession } = props;
  useEffect(() => {
    if (state.phase !== "ready") {
      return undefined;
    }
    onSession?.(sessionRef.current);
    return () => onSession?.(null);
  }, [state.phase, onSession, sessionRef]);
  const { fitNonce } = props;
  const lastFit = useRef(fitNonce);
  useEffect(() => {
    if (fitNonce !== lastFit.current) {
      lastFit.current = fitNonce;
      sessionRef.current?.userFit();
    }
  }, [fitNonce, sessionRef]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef]);

  const focusStage = useCallback(() => rootRef.current?.focus(), []);

  const startHints = () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    const map = session.hintMap();
    const at = new Map<number, { x: number; y: number }>();
    for (const node of map.labels.keys()) {
      at.set(node, session.nodeScreen(node));
    }
    setHints({ map, typed: "", at });
  };

  const onHintKey = (key: string, h: HintState) => {
    if (key === "Escape") {
      setHints(null);
    } else if (key === "Backspace") {
      setHints({ ...h, typed: h.typed.slice(0, -1) });
    } else if (key.length === 1) {
      const typed = h.typed + key.toLowerCase();
      const r = resolveHint(h.map, typed);
      if (r.kind === "match") {
        setHints(null);
        sessionRef.current?.activate(r.node);
      } else if (r.kind === "partial") {
        setHints({ ...h, typed });
      } else {
        setHints(null);
      }
    }
  };

  // Link-hint typing: while hints show, every key is a hint letter, so the
  // graph.* commands are withdrawn (below) and keys reach this handler.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isField(e.target) || !hints) {
      return;
    }
    e.preventDefault();
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      onHintKey(e.key, hints);
    }
  };

  // graph.* in-view commands (graphCommands.ts), bound while the view is open.
  const V = GRAPH_VIEW_COMMAND_IDS;
  const move = (dir: Direction) => () => sessionRef.current?.moveFocus(dir);
  const depth = (d: 1 | 2 | 3) => () =>
    props.onSettingsChange({ ...settings, localDepth: d });
  const zoom = (f: number) => () => sessionRef.current?.zoomCentre(f);
  // While hints show, the view's scope changes (data-keyscope below), so the graph.* keys are
  // not claimed and every key reaches onKeyDown as a hint letter.
  useViewCommands(rootRef, {
    [GRAPH_COMMAND_IDS.fit]: () => sessionRef.current?.userFit(),
    ...(hints
      ? {}
      : {
          [V.left]: move("left"),
          [V.right]: move("right"),
          [V.up]: move("up"),
          [V.down]: move("down"),
          [V.openNode]: () => {
            const s = sessionRef.current;
            s?.activate(s.shown >= 0 ? s.shown : s.focus);
          },
          [V.filter]: () => {
            filterRef.current?.focus();
            filterRef.current?.select();
          },
          [V.toggleLocal]: () =>
            props.onModeChange(mode === "local" ? "global" : "local"),
          [V.depth1]: depth(1),
          [V.depth2]: depth(2),
          [V.depth3]: depth(3),
          [V.hints]: startHints,
          [V.zoomIn]: zoom(ZOOM_STEP),
          [V.zoomOut]: zoom(1 / ZOOM_STEP),
          [V.close]: onClose,
          // command audit (S8)
          [V.toggleArrows]: () =>
            props.onSettingsChange({ ...settings, arrows: !settings.arrows }),
          [V.toggleColourBy]: () =>
            props.onSettingsChange({
              ...settings,
              colourBy: settings.colourBy === "mono" ? "folder" : "mono",
            }),
          [V.toggleSettings]: () => setPanelOpen((v) => !v),
          [V.resetDisplay]: () =>
            props.onSettingsChange(resetDisplayAndForces(settings)),
        }),
  });
  useStyle(rootRef, graphCss);

  const session = sessionRef.current;
  const hintLetters =
    shown && session ? session.hintMap().labels.get(shown.node) ?? null : null;
  const path = shown && session ? session.pathOf(shown.node) : null;

  return (
    <div
      ref={rootRef}
      className="vd-graph"
      tabIndex={-1}
      role="application"
      aria-label="Graph view"
      data-testid="graph-view"
      data-keyscope={hints ? "graph-hints" : "graph"}
      onKeyDown={onKeyDown}
    >
      <GraphToolbar
        settings={settings}
        onSettingsChange={props.onSettingsChange}
        mode={mode}
        onModeChange={props.onModeChange}
        onFit={() => sessionRef.current?.userFit()}
        onClose={onClose}
        panelOpen={panelOpen}
        onPanelToggle={() => setPanelOpen((v) => !v)}
        filterRef={filterRef}
        onFilterDone={focusStage}
      />
      <div className="vd-graph__body">
        <div
          ref={stageRef}
          className="vd-graph__stage"
          data-testid="graph-stage"
        >
          <canvas ref={overlayRef} className="vd-graph__overlay" />
          {shown && (
            <HoverCard
              shown={shown}
              shortcut={
                path && props.shortcutFor ? props.shortcutFor(path) : null
              }
              hint={hintLetters}
              width={size.w}
              height={size.h}
            />
          )}
          {hints &&
            [...hints.map.labels].map(([node, label]) => {
              if (!label.startsWith(hints.typed)) {
                return null;
              }
              const p = hints.at.get(node)!;
              return (
                <span
                  key={node}
                  className="vd-graph__hint"
                  style={{
                    transform: `translate(${p.x + 6}px, ${p.y - 18}px)`,
                  }}
                >
                  <b>{label.slice(0, hints.typed.length)}</b>
                  {label.slice(hints.typed.length)}
                </span>
              );
            })}
          {state.phase === "loading" && (
            <div className="vd-graph__note">Loading graph…</div>
          )}
          {state.phase === "error" && (
            <div className="vd-graph__note" role="alert">
              Could not load the graph{state.error ? `: ${state.error}` : ""}
            </div>
          )}
          {state.phase === "ready" && state.nodeCount === 0 && (
            <div className="vd-graph__note">
              No linked drawings yet. Type [[ in a drawing to link it.
            </div>
          )}
        </div>
        {panelOpen && (
          <SettingsPanel
            settings={settings}
            onChange={props.onSettingsChange}
          />
        )}
      </div>
    </div>
  );
}
