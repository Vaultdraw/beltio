/**
 * Time slicing for the thumbnail render: the scene is painted in slices of
 * about SLICE_BUDGET_MS and control goes back to the event loop between them,
 * so input, rAF and the live editor are never blocked for a whole render.
 * Same canvas calls in the same order, so the PNG is pixel-identical to the
 * unsliced render (e2e/thumbnailPixels.spec.ts).
 */
import type { SceneSlicing } from "@excalidraw/excalidraw/renderer/staticScene";

/** One 60 Hz frame is 16.7 ms; half of it leaves room for input and paint. */
export const SLICE_BUDGET_MS = 6;

let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

/**
 * Next macrotask without the 4 ms nested-timer clamp: MessageChannel, one
 * path for every engine. scheduler.yield() is not used: its continuation
 * outranks queued timers, so timer-driven work (and the 1 ms heartbeat of
 * e2e/thumbnailsBlocking.spec.ts) would still wait for the whole render.
 */
export const yieldToMain = (): Promise<void> => {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel!.port2.postMessage(0);
  });
};

/** Thrown at a slice boundary once `cancelled()` is true: stops the render. */
export class RenderCancelled extends Error {
  constructor() {
    super("thumbnail render cancelled");
    this.name = "RenderCancelled";
  }
}

/** `cancelled` is checked after every yield (no cost between slices). */
export const sceneSlicing = (cancelled?: () => boolean): SceneSlicing => ({
  budgetMs: SLICE_BUDGET_MS,
  yieldFn: cancelled
    ? async () => {
        await yieldToMain();
        if (cancelled()) {
          throw new RenderCancelled();
        }
      }
    : yieldToMain,
});
