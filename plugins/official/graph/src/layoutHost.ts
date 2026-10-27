/**
 * Message handling and tick scheduling for the force layout. Environment-free: the worker
 * (`layout.worker.ts`) and the in-thread fallback (`layoutClient.ts`) both drive one LayoutHost.
 *
 * Protocol (main -> worker):
 *   init     {n, edges, positions, settings?, params?, mask?, alpha?, focus?, tickMs?}  (edges, positions,
 *            mask, focus are transferred; positions becomes the worker's live array)
 *   settings {settings}          partial ForceSettings, reheats (alpha 0.3)
 *   drag     {node, x, y}        pin node, relax only its 2-hop neighbourhood
 *   release                      unpin; the neighbourhood cools, then `settled`
 *   reheat   {alpha?}            global reheat
 *   mask     {mask}              Uint8Array(n), 1 = hidden by a filter, or null; reheats (0.1)
 *   recycle  {buffer}            give a consumed positions buffer back (ping-pong)
 *   stop                         stop ticking and drop the layout
 * Protocol (worker -> main):
 *   positions {positions, tick, alpha}  Float32Array(2n), transferred; send it back via `recycle`
 *   settled   {tick}                    posted once after the final `positions`; nothing runs after
 */
import {
  ForceLayout,
  type ForceSettings,
  type LayoutParams,
} from "./barnesHut";

export type ToLayout =
  | {
      type: "init";
      n: number;
      edges: Uint32Array;
      positions: Float32Array;
      settings?: Partial<ForceSettings>;
      params?: Partial<LayoutParams>;
      mask?: Uint8Array | null;
      alpha?: number;
      focus?: Uint32Array | null;
      /** Minimum ms between ticks (live pacing); 0 = tick for SLICE_MS per turn. */
      tickMs?: number;
    }
  | { type: "settings"; settings: Partial<ForceSettings> }
  | { type: "drag"; node: number; x: number; y: number }
  | { type: "release" }
  | { type: "reheat"; alpha?: number }
  | { type: "mask"; mask: Uint8Array | null }
  | { type: "recycle"; buffer: ArrayBuffer }
  | { type: "stop" };

export type FromLayout =
  | { type: "positions"; positions: Float32Array; tick: number; alpha: number }
  | { type: "settled"; tick: number };

/** Time spent ticking before yielding to the message loop and posting positions. */
export const SLICE_MS = 8;
/** Live pacing: one tick per display frame (60 Hz), so the layout visibly moves. */
export const TICK_MS = 1000 / 60;
/** Positions buffers in flight before the host stops posting (backpressure). */
const MAX_IN_FLIGHT = 2;

export class LayoutHost {
  private layout: ForceLayout | null = null;
  private running = false;
  private scheduled = false;
  private free: ArrayBuffer[] = [];
  private inFlight = 0;

  /**
   * @param post sends a message to the main side (transfer list given)
   * @param schedule asks the environment to call `run()` after `delayMs` (0 = next message-loop
   *   turn). At most one request is pending at a time.
   * @param tickMs minimum ms between ticks; 0 = tick for `sliceMs` per run (fast settling)
   * @param cancel drops a pending `schedule` request (called on stop)
   */
  constructor(
    private readonly post: (msg: FromLayout, transfer: ArrayBuffer[]) => void,
    private readonly schedule: (delayMs: number) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly sliceMs = SLICE_MS,
    private tickMs = TICK_MS,
    private readonly cancel: () => void = () => {},
  ) {}

  get active(): boolean {
    return this.running;
  }

  handle(m: ToLayout): void {
    switch (m.type) {
      case "init":
        if (m.tickMs !== undefined) {
          this.tickMs = m.tickMs;
        }
        this.free = [];
        this.inFlight = 0;
        this.layout = new ForceLayout({
          nodeCount: m.n,
          edges: m.edges,
          positions: m.positions,
          settings: m.settings,
          params: m.params,
          mask: m.mask,
          alpha: m.alpha,
          focus: m.focus,
        });
        this.start();
        break;
      case "settings":
        this.layout?.setSettings(m.settings);
        this.start();
        break;
      case "drag":
        this.layout?.drag(m.node, m.x, m.y);
        this.start();
        break;
      case "release":
        this.layout?.release();
        this.start();
        break;
      case "reheat":
        this.layout?.reheat(m.alpha);
        this.start();
        break;
      case "mask":
        this.layout?.setMask(m.mask);
        this.start();
        break;
      case "recycle":
        this.inFlight = Math.max(0, this.inFlight - 1);
        if (this.layout && m.buffer.byteLength === 8 * this.layout.n) {
          this.free.push(m.buffer);
        }
        break;
      case "stop":
        this.running = false;
        this.layout = null;
        this.free = [];
        this.cancel();
        this.scheduled = false;
        break;
    }
  }

  /**
   * One scheduled turn, then post positions and reschedule or settle. Paced (`tickMs > 0`): one
   * tick, next turn `tickMs` after this one started (immediately if the tick was slower).
   * Unpaced: tick for about `sliceMs`.
   */
  run(): void {
    this.scheduled = false;
    const layout = this.layout;
    if (!layout || !this.running) {
      return;
    }
    const start = this.now();
    const paced = this.tickMs > 0;
    const deadline = start + this.sliceMs;
    do {
      layout.tick();
    } while (!paced && !layout.settled && this.now() < deadline);
    if (layout.settled) {
      this.running = false;
      this.postPositions(layout, true);
      this.post({ type: "settled", tick: layout.tickCount }, []);
    } else {
      this.postPositions(layout, false);
      this.requestRun(
        paced ? Math.max(0, this.tickMs - (this.now() - start)) : 0,
      );
    }
  }

  private start(): void {
    if (this.layout && !this.layout.settled) {
      this.running = true;
      this.requestRun(0);
    }
  }

  private requestRun(delayMs: number): void {
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(delayMs);
    }
  }

  private postPositions(layout: ForceLayout, force: boolean): void {
    if (!force && this.inFlight >= MAX_IN_FLIGHT) {
      return;
    }
    const buf = this.free.pop() ?? new ArrayBuffer(8 * layout.n);
    const out = new Float32Array(buf);
    out.set(layout.positions);
    this.inFlight++;
    this.post(
      {
        type: "positions",
        positions: out,
        tick: layout.tickCount,
        alpha: layout.alpha,
      },
      [buf],
    );
  }
}
