import { describe, expect, it } from "vitest";

import { createToastStore } from "./toastStore";

describe("bug hunt: notice time 0 means until dismissed", () => {
  const run = (withButton: boolean) => {
    let t = 0;
    const store = createToastStore(() => t);
    store.setErrorMs(0); // interface.notice_seconds = 0
    store.push({
      message: "Import failed",
      kind: "error",
      ...(withButton
        ? { actions: [{ label: "View report", run: () => {} }] }
        : {}),
    });
    t = 60_000;
    store.expire();
    return store.getSnapshot().toasts.length;
  };
  it("an error without a button stays", () => {
    expect(run(false)).toBe(1);
  });
  it("an error with a button also stays", () => {
    expect(run(true)).toBe(1);
  });
});
