// Did a packaged run's window stay visible? Built from the in-app heartbeats (document.visibilityState)
// and the native window-state log the test build writes (state/window-state.jsonl, hidden_render.rs).

/** Parse window-state.jsonl text into records; bad lines are skipped. */
export function parseWindowStateLog(text = "") {
  const out = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* partial last line */
    }
  }
  return out;
}

/**
 * Summary of a run's window visibility.
 * hidden: the page or the native window was hidden/off-screen at some point while the run went on.
 * Frame pacing (rafInterval, fps, render rate) is tied to the display only when hidden is false.
 */
export function windowSummary({ visibilities = [], native = [] } = {}) {
  const pageHidden = visibilities.filter((v) => v && v !== "visible").length;
  const offScreen = native.filter(
    (n) => n && (n.monitor == null || n.mac?.hasScreen === false),
  ).length;
  const occluded = native.filter(
    (n) => n?.mac && n.mac.occlusionVisible === false,
  ).length;
  const hidden = pageHidden > 0 || offScreen > 0 || occluded > 0;
  return {
    hidden,
    heartbeats: visibilities.length,
    pageHiddenHeartbeats: pageHidden,
    nativeSamples: native.length,
    offScreenSamples: offScreen,
    occludedSamples: occluded,
    known: visibilities.length > 0 || native.length > 0,
  };
}

/** One-line note for a run that ran hidden: which numbers stay valid. */
export const HIDDEN_RUN_NOTE =
  "ran hidden (window off-screen or occluded, hidden rendering on): CPU, memory, counts and open/save timings are valid; frame pacing (rafInterval, fps, renderHz, missedInputHz) is not tied to a display and is not comparable";
