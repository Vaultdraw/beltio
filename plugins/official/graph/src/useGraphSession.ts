/** React glue for GraphSession: creates it on mount, feeds it props, tears it down on unmount. */
import { useEffect, useRef, useState } from "react";

import { LayoutClient } from "./layoutClient";
import { bindPointer } from "./pointer";
import { createRenderer } from "./renderer/pick";
import {
  GraphSession,
  type GraphSource,
  type SessionInputs,
  type SessionState,
  type ShownNode,
} from "./GraphSession";

import type { OpenTarget } from "./settings";

export interface UseGraphSessionOptions {
  handle: string;
  source: GraphSource;
  inputs: SessionInputs;
  forceCanvas2d?: boolean;
  onOpen: (path: string, target?: OpenTarget) => void;
  /** Called on pointer/wheel interaction (e.g. leave hint mode). */
  onInteract?: () => void;
}

/** Quiet time after the last file change before the open graph re-reads its data. */
export const REFRESH_DELAY_MS = 400;

export function useGraphSession(opts: UseGraphSessionOptions) {
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GraphSession | null>(null);
  const [state, setState] = useState<SessionState>({
    phase: "loading",
    nodeCount: 0,
  });
  const [shown, setShown] = useState<ShownNode | null>(null);

  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (!stage || !overlay) {
      return undefined;
    }
    const session = new GraphSession({
      handle: opts.handle,
      host: stage,
      overlay,
      source: opts.source,
      ui: {
        shown: setShown,
        state: setState,
        open: (p, target) => latest.current.onOpen(p, target),
      },
      createRenderer: (host) =>
        createRenderer(host, { forceCanvas2d: opts.forceCanvas2d }),
      createLayout: (cb) => new LayoutClient(cb),
    });
    sessionRef.current = session;
    session.apply(latest.current.inputs);
    const measure = () => {
      const r = stage.getBoundingClientRect();
      session.resize(r.width, r.height, window.devicePixelRatio || 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    const unbind = bindPointer(stage, session, () =>
      latest.current.onInteract?.(),
    );
    void session.load();
    // Files changed while the graph is open: refresh once the burst settles (a save, an outside
    // rename and the link index catching up arrive as several events).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = opts.source.onChange?.(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void session.refresh();
      }, REFRESH_DELAY_MS);
    });
    return () => {
      unsubscribe?.();
      if (timer) {
        clearTimeout(timer);
      }
      unbind();
      ro.disconnect();
      session.dispose();
      sessionRef.current = null;
    };
    // the session is rebuilt only when what it loads changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.handle, opts.source, opts.forceCanvas2d]);

  const { inputs } = opts;
  useEffect(() => {
    sessionRef.current?.apply(inputs);
  }, [inputs.mode, inputs.currentPath, inputs.settings, inputs.themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stageRef, overlayRef, sessionRef, state, shown };
}
