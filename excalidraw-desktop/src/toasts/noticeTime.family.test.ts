import { describe, expect, it } from "vitest";

import { ACTION_MS } from "./queue";
import { createToastStore } from "./toastStore";

import type { ToastInput } from "./queue";

/**
 * Family sweep (bug hunt BH-5): the "Error notices stay for" setting applies to every error
 * notice, whatever it carries (one action, several buttons, none). Rows: shape x setting.
 */
const shapes: Record<"plain" | "action" | "buttons", Partial<ToastInput>> = {
  plain: {},
  action: { action: { label: "Retry", run: () => {} } },
  buttons: { actions: [{ label: "View report", run: () => {} }] },
};

const alive = (shape: keyof typeof shapes, errorMs: number, at: number) => {
  let t = 0;
  const store = createToastStore(() => t);
  store.setErrorMs(errorMs);
  store.push({ message: "Import failed", kind: "error", ...shapes[shape] });
  t = at;
  store.expire();
  return store.getSnapshot().toasts.length === 1;
};

describe("error notice lifetime follows the user's setting", () => {
  it.each(Object.keys(shapes) as (keyof typeof shapes)[])(
    "%s: 0 means until dismissed",
    (shape) => {
      expect(alive(shape, 0, 3_600_000)).toBe(true);
    },
  );
  it.each(Object.keys(shapes) as (keyof typeof shapes)[])(
    "%s: a long setting (60 s) is kept",
    (shape) => {
      expect(alive(shape, 60_000, 59_000)).toBe(true);
      expect(alive(shape, 60_000, 61_000)).toBe(false);
    },
  );
  it("a short setting never hides a button before an action toast would", () => {
    expect(alive("buttons", 2_000, ACTION_MS - 1)).toBe(true);
    expect(alive("plain", 2_000, 2_001)).toBe(false);
  });
});
