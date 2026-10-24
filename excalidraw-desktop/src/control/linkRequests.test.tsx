import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_GUARD_MS } from "../components/ConfirmModal";

import {
  createLinkRequests,
  LinkRequestHost,
  MAX_PENDING_REQUESTS,
} from "./linkRequests";

import type { AskSpec } from "./uriRun";

afterEach(() => {
  vi.useRealTimers();
});

const spec = (n: number, onConfirm = vi.fn()): AskSpec => ({
  title: "Create drawing?",
  message: "A link from outside wants to:",
  details: [`Create the drawing "${n}.excalidraw"`],
  confirmLabel: "Create",
  onConfirm,
});

describe("link requests queue", () => {
  it("security: at most 3 wait; identical ones merge; one notice says how many were dropped", () => {
    const notify = vi.fn();
    const store = createLinkRequests(notify);
    store.ask(spec(1));
    store.ask(spec(1)); // identical: merged
    store.ask(spec(2));
    store.ask(spec(3));
    store.ask(spec(4)); // over the cap
    store.ask(spec(5));
    store.ask(spec(6));
    expect(MAX_PENDING_REQUESTS).toBe(3);
    expect(notify).toHaveBeenCalledTimes(1); // one notice at the first drop
    const confirmed: AskSpec[] = [];
    for (let i = 0; i < 3; i += 1) {
      const head = store.head()!;
      expect(head.details[0]).toContain(`${i + 1}.excalidraw`);
      confirmed.push(head);
      store.resolve(false);
    }
    expect(store.head()).toBeNull();
    expect(notify).toHaveBeenLastCalledWith(
      "3 more link requests were dropped",
    );
  });

  it("cancel never runs the action; confirm runs it once", () => {
    const store = createLinkRequests(vi.fn());
    const a = vi.fn();
    const b = vi.fn();
    store.ask(spec(1, a));
    store.ask(spec(2, b));
    store.resolve(false);
    store.resolve(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("link dialog guard", () => {
  it("security: focus starts on Cancel and Confirm ignores clicks for 600 ms", () => {
    vi.useFakeTimers();
    const store = createLinkRequests(vi.fn());
    const onConfirm = vi.fn();
    store.ask(spec(1, onConfirm));
    render(<LinkRequestHost store={store} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    const create = screen.getByRole("button", { name: "Create" });
    fireEvent.click(create);
    fireEvent.keyDown(create, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(store.head()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(CONFIRM_GUARD_MS + 10);
    });
    fireEvent.click(create);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("each queued dialog gets its own guard time", () => {
    vi.useFakeTimers();
    const store = createLinkRequests(vi.fn());
    const second = vi.fn();
    store.ask(spec(1));
    store.ask(spec(2, second));
    render(<LinkRequestHost store={store} />);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_GUARD_MS + 10);
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" })); // first
    // The second dialog has just appeared: a held key or double click must not confirm it.
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(second).not.toHaveBeenCalled();
  });
});

describe("a question with more than one answer", () => {
  it("security: the extra choice is guarded like Confirm and runs only its own action", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    const other = vi.fn();
    const store = createLinkRequests(vi.fn());
    store.ask({
      ...spec(1, confirm),
      confirmLabel: "Copy into vault",
      alternatives: [{ label: "Open its folder as a vault", run: other }],
    });
    render(<LinkRequestHost store={store} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open its folder as a vault" }),
    );
    expect(other).not.toHaveBeenCalled(); // inside the guard time
    act(() => {
      vi.advanceTimersByTime(CONFIRM_GUARD_MS + 1);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open its folder as a vault" }),
    );
    expect(other).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(store.head()).toBeNull();
  });

  it("Cancel runs nothing", () => {
    const other = vi.fn();
    const confirm = vi.fn();
    const store = createLinkRequests(vi.fn());
    store.ask({
      ...spec(1, confirm),
      alternatives: [{ label: "Other", run: other }],
    });
    render(<LinkRequestHost store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(other).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
