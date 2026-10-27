/**
 * Memory diagnosis for perf builds only: remembers every canvas that gets a
 * context (DOM and offscreen), so a perf mark can list the big live ones with
 * where they were created. Installed from main.tsx before anything renders.
 */
type Entry = {
  ref: WeakRef<HTMLCanvasElement | OffscreenCanvas>;
  kind: string;
  stack: string;
};

const entries: Entry[] = [];

const caller = () =>
  (new Error().stack ?? "")
    .split("\n")
    .slice(2, 7)
    .map((line) => line.trim().replace(/https?:\/\/[^/]+\//, ""))
    .join(" < ");

function wrap(proto: { getContext: (...args: any[]) => unknown } | undefined) {
  if (!proto) {
    return;
  }
  const original = proto.getContext;
  proto.getContext = function (
    this: HTMLCanvasElement | OffscreenCanvas,
    ...args: any[]
  ) {
    const context = original.apply(this, args);
    if (context && !entries.some((e) => e.ref.deref() === this)) {
      const options = args[1] ? JSON.stringify(args[1]) : "";
      entries.push({
        ref: new WeakRef(this),
        kind: `${String(args[0])}${options}`,
        stack: caller(),
      });
    }
    return context;
  };
}

const resizes: string[] = [];

function watchSize(proto: any, win: Window, prop: "width" | "height") {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc?.set || !desc.get) {
    return;
  }
  Object.defineProperty(proto, prop, {
    ...desc,
    set(this: HTMLCanvasElement, value: number) {
      const before = desc.get!.call(this);
      desc.set!.call(this, value);
      const after = desc.get!.call(this);
      const big =
        (prop === "width" ? after * this.height : this.width * after) >=
        250_000;
      if (before !== after && big && resizes.length < 400) {
        const cls = typeof this.className === "string" ? this.className : "";
        resizes.push(
          `${win.performance.now().toFixed(0)}ms ${
            cls || "(no class)"
          } ${prop} ${before}->${after} now ${this.width}x${this.height} ${
            this.isConnected ? "dom" : "detached"
          } | ${caller()}`,
        );
      }
    },
  });
}

export function installCanvasTracker(win: Window): void {
  const w = win as Window & typeof globalThis;
  watchSize(w.HTMLCanvasElement?.prototype, win, "width");
  watchSize(w.HTMLCanvasElement?.prototype, win, "height");
  wrap(w.HTMLCanvasElement?.prototype as any);
  wrap(w.OffscreenCanvas?.prototype as any);
}

/** Live canvases with at least `minPixels`, biggest first. */
export function canvasCensus(minPixels = 250_000): string {
  const lines: string[] = [];
  let live = 0;
  let total = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const canvas = entries[i].ref.deref();
    if (!canvas) {
      entries.splice(i, 1);
      continue;
    }
    live++;
    const pixels = canvas.width * canvas.height;
    total += pixels;
    if (pixels >= minPixels) {
      const attached =
        "isConnected" in canvas
          ? canvas.isConnected
            ? "dom"
            : "detached"
          : "offscreen";
      lines.push(
        `${((pixels * 4) / 1048576).toFixed(1)} MB ${canvas.width}x${
          canvas.height
        } ${attached} ${entries[i].kind} | ${entries[i].stack}`,
      );
    }
  }
  lines.sort((a, b) => parseFloat(b) - parseFloat(a));
  lines.push("-- big canvas resizes so far:", ...resizes);
  lines.push(
    `live canvases ${live}, ${((total * 4) / 1048576).toFixed(
      1,
    )} MB at 4 bytes per pixel`,
  );
  return lines.join("\n");
}
