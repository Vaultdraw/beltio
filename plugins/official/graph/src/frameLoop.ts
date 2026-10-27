/**
 * Render-on-demand scheduler. `invalidate()` requests one animation frame (coalesced); when the
 * render callback returns true (an animation is running) it asks for the next one itself.
 * Idle = no rAF callbacks at all.
 */
export interface FrameLoopStats {
  /** rAF callbacks executed. */
  frames: number;
  /** invalidate() calls (including coalesced ones). */
  invalidations: number;
}

export interface FrameLoopDeps {
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}

export class FrameLoop {
  readonly stats: FrameLoopStats = { frames: 0, invalidations: 0 };
  private id = 0;
  private pending = false;
  private disposed = false;
  private readonly raf: (cb: (t: number) => void) => number;
  private readonly caf: (id: number) => void;

  /** `render(now)` returns true to keep the loop going (tweens), otherwise it goes idle. */
  constructor(
    private readonly render: (now: number) => boolean | void,
    deps: FrameLoopDeps = {},
  ) {
    this.raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  }

  get scheduled(): boolean {
    return this.pending;
  }

  invalidate(): void {
    this.stats.invalidations++;
    if (this.pending || this.disposed) {
      return;
    }
    this.pending = true;
    this.id = this.raf(this.tick);
  }

  private readonly tick = (now: number) => {
    this.pending = false;
    if (this.disposed) {
      return;
    }
    this.stats.frames++;
    if (this.render(now) === true) {
      this.invalidate();
    }
  };

  dispose(): void {
    this.disposed = true;
    if (this.pending) {
      this.caf(this.id);
      this.pending = false;
    }
  }
}
