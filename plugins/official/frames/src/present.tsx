/**
 * The presentation controller: one frame per slide, fitted to the screen. The host
 * (`ctx.present`) does full screen, hides the chrome and holds the laser; this file knows the
 * slides, the current one and the progress strip. Nothing exists until a presentation starts.
 */
import { useSyncExternalStore } from "react";

import { startIndex, type FrameBox } from "./order";
import { slidesOf } from "./store";

import type {
  OverlayHandle,
  PluginContext,
  PresentSession,
} from "@vaultdraw/api";

export interface Settings {
  transition: "none" | "fade";
  background: string;
  showProgress: boolean;
}

export const readSettings = (ctx: PluginContext): Settings => ({
  transition:
    ctx.settings.get<string>("transition") === "fade" ? "fade" : "none",
  background: String(ctx.settings.get<string>("background") ?? "").trim(),
  showProgress: ctx.settings.get<boolean>("show_progress") !== false,
});

interface View {
  index: number;
  count: number;
  veil: boolean;
  settings: Settings;
}

const FADE_MS = 160;
const PADDING = 24;

function Strip({
  subscribe,
  get,
  go,
}: {
  subscribe: (cb: () => void) => () => void;
  get: () => View;
  go: (i: number) => void;
}) {
  const v = useSyncExternalStore(subscribe, get, get);
  return (
    <>
      <div
        className="vd-present-veil"
        data-on={v.veil}
        style={
          v.settings.background
            ? ({
                "--vd-present-bg": v.settings.background,
              } as React.CSSProperties)
            : undefined
        }
      />
      {v.settings.showProgress && (
        <div
          className="vd-present-strip"
          data-testid="present-strip"
          role="status"
          aria-label={`Slide ${v.index + 1} of ${v.count}`}
        >
          <div className="vd-present-dots">
            {Array.from({ length: v.count }, (_, i) => (
              <button
                key={i}
                type="button"
                className="vd-present-dot"
                data-current={i === v.index}
                aria-label={`Slide ${i + 1}`}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <span className="vd-present-count">
            {v.index + 1} / {v.count}
          </span>
        </div>
      )}
    </>
  );
}

export interface Presenter {
  start(from: "current" | "first"): Promise<void>;
  go(i: number): void;
  last(): void;
  step(by: number): void;
  toggleLaser(): void;
  end(): void;
  readonly active: boolean;
}

export function createPresenter(ctx: PluginContext): Presenter {
  let session: PresentSession | null = null;
  let overlay: OverlayHandle | null = null;
  let slides: FrameBox[] = [];
  let view: View = {
    index: 0,
    count: 0,
    veil: false,
    settings: readSettings(ctx),
  };
  let fadeTimer = 0;
  const listeners = new Set<() => void>();
  const set = (next: Partial<View>) => {
    view = { ...view, ...next };
    listeners.forEach((l) => l());
  };

  const show = (i: number) => {
    const frame = slides[i];
    if (!frame) {
      return;
    }
    const jump = () =>
      ctx.scene.fitTo(frame.id, { padding: PADDING, animate: false });
    window.clearTimeout(fadeTimer);
    if (view.settings.transition === "fade" && i !== view.index) {
      set({ index: i, veil: true });
      fadeTimer = window.setTimeout(() => {
        jump();
        set({ veil: false });
      }, FADE_MS);
    } else {
      jump();
      set({ index: i, veil: false });
    }
  };

  const end = () => {
    window.clearTimeout(fadeTimer);
    const s = session;
    session = null;
    overlay?.dispose();
    overlay = null;
    s?.end();
  };

  return {
    get active() {
      return session !== null;
    },
    async start(from) {
      if (!ctx.scene.path()) {
        ctx.ui.toast("Open a drawing first");
        return;
      }
      slides = slidesOf(ctx);
      if (slides.length === 0) {
        ctx.ui.toast(
          "No frames in this drawing. Draw one with the Frame tool (F).",
        );
        return;
      }
      const first =
        from === "first"
          ? 0
          : startIndex(
              slides,
              ctx.scene.selection(),
              ctx.scene.viewportCenter(),
            );
      const settings = readSettings(ctx);
      end();
      view = { index: first, count: slides.length, veil: false, settings };
      let started: PresentSession;
      try {
        started = await ctx.present.start({
          background: settings.background || undefined,
          onEnd: () => {
            if (session === started) {
              end();
            }
          },
        });
      } catch {
        ctx.ui.toast("Could not start the presentation");
        return;
      }
      session = started;
      overlay = ctx.overlays.open(
        () => (
          <Strip
            subscribe={(cb) => {
              listeners.add(cb);
              return () => listeners.delete(cb);
            }}
            get={() => view}
            go={(i) => show(i)}
          />
        ),
        { modal: true, onClose: () => session === started && end() },
      );
      // The editor needs a frame to take the full-screen size before it can fit to it.
      requestAnimationFrame(() => requestAnimationFrame(() => show(first)));
    },
    go: (i) => session && show(i),
    last: () => session && show(view.count - 1),
    step(by) {
      if (session) {
        show(Math.max(0, Math.min(view.count - 1, view.index + by)));
      }
    },
    toggleLaser() {
      session?.setLaser(!session.laser);
    },
    end,
  };
}
