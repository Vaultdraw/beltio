import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { DEFAULT_PREFERENCES, updatePreferences } from "../vault/preferences";

import { PluginToolbar } from "./PluginToolbar";
import {
  addToolbarButtons,
  getToolbarButtons,
  type ToolbarButton,
} from "./toolbarRegistry";

const button = (over: Partial<ToolbarButton> = {}): ToolbarButton => ({
  pluginId: "p",
  pluginName: "P",
  title: "Go",
  icon: null,
  priority: 0,
  command: "p.go",
  ...over,
});

const offs: (() => void)[] = [];
afterEach(() => {
  offs.splice(0).forEach((o) => o());
  updatePreferences(
    { pluginsToolbar: DEFAULT_PREFERENCES.pluginsToolbar },
    window,
  );
});

describe("toolbar registry", () => {
  it("is one shared empty array without buttons", () => {
    const a = getToolbarButtons();
    expect(a).toEqual([]);
    expect(getToolbarButtons()).toBe(a);
  });

  it("orders by priority, then command, and removes on dispose", () => {
    const off1 = addToolbarButtons([
      button({ command: "p.b" }),
      button({ command: "p.a" }),
    ]);
    const off2 = addToolbarButtons([button({ command: "q.z", priority: 5 })]);
    expect(getToolbarButtons().map((b) => b.command)).toEqual([
      "q.z",
      "p.a",
      "p.b",
    ]);
    off2();
    off1();
    expect(getToolbarButtons()).toEqual([]);
  });
});

describe("PluginToolbar", () => {
  it("renders nothing without buttons", () => {
    const { container } = render(<PluginToolbar win={window} />);
    expect(container.firstChild).toBeNull();
  });

  it("draws a button, runs its command on click and hides when turned off", () => {
    const run = vi.fn();
    offs.push(registerCommandHandlers({ "p.go": run }));
    offs.push(
      addToolbarButtons([button({ title: "Go there", icon: "M0 0h24" })]),
    );
    render(<PluginToolbar win={window} />);
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    expect(run).toHaveBeenCalledTimes(1);
    act(() => updatePreferences({ pluginsToolbar: false }, window));
    expect(screen.queryByTestId("plugin-toolbar")).toBeNull();
  });
});
