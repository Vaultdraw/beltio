/**
 * Starts CSS snippets after the first frame, from a lazy chunk. The app
 * shell calls this once; it costs one effect until the chunk loads.
 */
import { useEffect } from "react";

export function useSnippets(doc: Document | null, win: Window | null): void {
  useEffect(() => {
    if (!doc || !win) {
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    const frame = win.requestAnimationFrame(() => {
      void import("./boot").then(({ startSnippets }) => {
        if (!cancelled) {
          stop = startSnippets(doc, win);
        }
      });
    });
    return () => {
      cancelled = true;
      win.cancelAnimationFrame(frame);
      stop?.();
    };
  }, [doc, win]);
}
