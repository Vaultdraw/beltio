import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { libraryPanelStore } from "../library/libraryPanelState";

import { IconSearch } from "../components/Icons";

import { activityBarRegistry } from "./activityBarRegistry";
import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

const setup = (
  over: {
    available?: (id: string) => boolean;
    drawingOpen?: boolean;
    order?: string[];
    hidden?: string[];
  } = {},
) => {
  const run = vi.fn(() => true);
  render(
    <ActivityBar
      run={run}
      isAvailable={over.available ?? (() => true)}
      hasHandler={(id) => id !== "tags.focusPane"}
      drawingOpen={over.drawingOpen ?? true}
      writable
      order={over.order ?? []}
      hidden={over.hidden ?? []}
    />,
  );
  return run;
};

describe("ActivityBar", () => {
  it("hides entries without a handler and runs commands on click", () => {
    const run = setup();
    expect(screen.queryByTestId("activity-bar-tags")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-bar-search"));
    expect(run).toHaveBeenCalledWith("navigator.focusSearch");
  });

  it("follows the configured order and hides entries", () => {
    setup({ order: ["settings", "search"], hidden: ["history"] });
    const ids = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-entry"));
    expect(ids).not.toContain("history");
    expect(ids.indexOf("search")).toBeLessThan(ids.indexOf("library"));
    expect(ids.slice(-2)).toEqual(["settings", "hotkeys"]);
  });

  it("disabled entries stay focusable and do nothing", () => {
    const run = setup({
      available: (id) => id !== "history.toggle",
      drawingOpen: false,
    });
    const button = screen.getByTestId("activity-bar-history");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "History - Open a drawing first");
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it("roves with the arrow keys without wrapping", () => {
    setup();
    const first = screen.getByTestId("activity-bar-library");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByTestId("activity-bar-history"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByTestId("activity-bar-settings"),
    );
    expect(screen.getByTestId("activity-bar-settings")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(first).toHaveAttribute("tabindex", "-1");
  });

  it("does not reopen a panel that its own pointerdown just closed", () => {
    const run = setup();
    const button = screen.getByTestId("activity-bar-library");
    libraryPanelStore.publish(true);
    fireEvent.pointerDown(button);
    libraryPanelStore.publish(false); // the sidebar's outside-click close
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
    fireEvent.pointerDown(button); // now closed: a click opens it again
    fireEvent.click(button);
    expect(run).toHaveBeenCalledWith("library.toggle");
  });
});

describe("ActivityBar slots", () => {
  it("shows a registered entry after the built-ins and removes it on dispose", () => {
    setup();
    const ids = () =>
      Array.from(
        screen
          .getByTestId("activity-bar")
          .querySelectorAll("button[data-entry]"),
      ).map((b) => (b as HTMLElement).dataset.entry);
    const before = ids();
    let dispose = () => {};
    act(() => {
      dispose = activityBarRegistry.register("activityBar.top", [
        {
          id: "p:extra",
          label: "Extra",
          icon: IconSearch,
          commandId: "graph.open",
          group: "top",
        },
      ]);
    });
    const after = ids();
    expect(after.indexOf("p:extra")).toBe(after.indexOf("templates") + 1);
    expect(after.indexOf("p:extra")).toBeLessThan(after.indexOf("hotkeys"));
    act(() => dispose());
    expect(ids()).toEqual(before);
  });
});
