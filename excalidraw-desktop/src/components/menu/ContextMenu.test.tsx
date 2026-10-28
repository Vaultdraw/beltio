import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu";

import type { MenuNode } from "./menuModel";

const run = vi.fn();
const nodes: MenuNode[] = [
  { kind: "item", id: "a", label: "Alpha", run },
  { kind: "item", id: "b", label: "Beta", run },
  { kind: "separator" },
  {
    kind: "submenu",
    id: "s",
    label: "Sub",
    items: [{ kind: "item", id: "c", label: "Child", run }],
  },
];

const setup = () => {
  const onClose = vi.fn();
  render(
    <ContextMenu x={10} y={10} label="Test" nodes={nodes} onClose={onClose} />,
  );
  return onClose;
};

const key = (k: string) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k });

describe("ContextMenu", () => {
  it("focuses the first item and moves with the arrows, wrapping", () => {
    setup();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Alpha" }),
    );
    key("ArrowDown");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Beta" }),
    );
    key("ArrowUp");
    key("ArrowUp");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Sub" }),
    );
    key("Home");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Alpha" }),
    );
  });

  it("type-ahead jumps to the matching item", () => {
    setup();
    key("s");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Sub" }),
    );
  });

  it("a submenu opens with the chevron item and closes with ArrowLeft", () => {
    setup();
    const sub = screen.getByRole("menuitem", { name: "Sub" });
    expect(sub.getAttribute("aria-haspopup")).toBe("menu");
    sub.focus();
    key("ArrowRight");
    expect(screen.getByRole("menuitem", { name: "Child" })).toBeTruthy();
    screen.getByRole("menuitem", { name: "Child" }).focus();
    key("ArrowLeft");
    expect(screen.queryByRole("menuitem", { name: "Child" })).toBeNull();
  });

  it("clicking an item closes the menu and runs it; Escape closes", () => {
    const onClose = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Beta" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
