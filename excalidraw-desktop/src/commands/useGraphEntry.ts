/**
 * UI entry points for the graph view (navigator button, main menu, a
 * drawing's row menu). They only dispatch the existing graph commands, so
 * this module stays tiny and never pulls in the lazy graph chunk.
 */
import { useCallback, useMemo, useRef } from "react";

import { GRAPH_COMMAND_IDS } from "../commands/graphCommands";
import { useRunOnDrawing } from "../commands/useRunOnDrawing";

type Run = (id: string) => boolean;

export interface GraphEntry {
  /** graph.open (toggles the graph view). */
  openGraph(): void;
  /**
   * The local graph centred on `path`. graph.openLocal works on the active
   * drawing, so another drawing is opened first and the command runs once it
   * is active. The request is dropped if the open fails or the user ends up
   * on a different drawing.
   */
  openLocalGraph(path: string): Promise<void>;
}

export function useGraphEntry(
  activePath: string | null,
  openDrawing: (path: string) => Promise<boolean>,
  run: Run,
): GraphEntry {
  const live = useRef(run);
  live.current = run;
  const runOnDrawing = useRunOnDrawing(activePath, openDrawing);

  const openGraph = useCallback(() => {
    live.current(GRAPH_COMMAND_IDS.open);
  }, []);

  const openLocalGraph = useCallback(
    (path: string) =>
      runOnDrawing(path, () => live.current(GRAPH_COMMAND_IDS.openLocal)),
    [runOnDrawing],
  );

  return useMemo(
    () => ({ openGraph, openLocalGraph }),
    [openGraph, openLocalGraph],
  );
}
