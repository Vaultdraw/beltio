/**
 * Before a packaged smoke run starts: is the WebView able to render?
 *
 * A visible page renders. A hidden page (window on another workspace, occluded, screen locked)
 * normally stops requestAnimationFrame, so the run would hang. Test builds with hidden rendering
 * (`hiddenRender` from smoke_environment, hidden_render.rs) keep rendering while hidden: accept
 * them once a frame actually arrives, and report that the run is hidden.
 */
export type RenderGate =
  | { ok: true; hidden: boolean }
  | { ok: false; reason: string };

type GateWindow = Pick<
  Window,
  "setTimeout" | "requestAnimationFrame" | "performance"
>;

export async function waitUntilRendering(
  win: GateWindow,
  doc: Pick<Document, "visibilityState">,
  hiddenRender: boolean,
  { visibleWaitMs = 15_000, frameWaitMs = 2_000 } = {},
): Promise<RenderGate> {
  const until = win.performance.now() + visibleWaitMs;
  while (doc.visibilityState !== "visible" && win.performance.now() < until) {
    await new Promise<void>((resolve) => win.setTimeout(resolve, 250));
  }
  if (doc.visibilityState === "visible") {
    return { ok: true, hidden: false };
  }
  const hiddenMsg = `WebView is ${doc.visibilityState} (screen locked or window occluded)`;
  if (!hiddenRender) {
    return {
      ok: false,
      reason: `${hiddenMsg}: the packaged smoke test needs a visible window`,
    };
  }
  const framed = await new Promise<boolean>((resolve) => {
    win.requestAnimationFrame(() => resolve(true));
    win.setTimeout(() => resolve(false), frameWaitMs);
  });
  return framed
    ? { ok: true, hidden: true }
    : {
        ok: false,
        reason: `${hiddenMsg} and no frame within ${frameWaitMs} ms although hidden rendering is on`,
      };
}
