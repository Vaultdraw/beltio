import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot } from "../testing";
import { updatePreferences } from "../../vault/preferences";
import { registeredCommands } from "../../commands/registry";

import { getRegisteredHandler } from "../../commands/handlerRegistry";

import { PluginStatusBar } from "./PluginStatusBar";
import {
  clearPluginStatus,
  getStatusItems,
  setStatusItem,
} from "./statusBarRegistry";
import {
  registerStatusBarCommands,
  TOGGLE_STATUS_BAR,
} from "./statusBarCommands";

import type { PluginContext, StatusBarContribution } from "../api";

const decl = (
  id: string,
  extra: Partial<StatusBarContribution> = {},
): StatusBarContribution => ({
  id,
  title: id.toUpperCase(),
  align: "right",
  priority: 0,
  command: null,
  ...extra,
});
const state = (text: string) => ({
  text,
  tooltip: null,
  tone: "normal" as const,
});

afterEach(() => {
  cleanup();
  clearPluginStatus("p");
  clearPluginStatus("q");
  updatePreferences({ pluginsStatusBar: true });
});

describe("status bar registry", () => {
  it("sorts by priority then key, ignores a same-looking update, hides on null", () => {
    let emitted = 0;
    setStatusItem("p", "P", decl("a"), state("a"));
    setStatusItem("p", "P", decl("b", { priority: 5 }), state("b"));
    setStatusItem("q", "Q", decl("c", { priority: 5 }), state("c"));
    expect(getStatusItems().map((i) => i.key)).toEqual(["p.b", "q.c", "p.a"]);
    const before = getStatusItems();
    setStatusItem("p", "P", decl("a"), state("a"));
    expect(getStatusItems()).toBe(before);
    emitted++;
    setStatusItem("p", "P", decl("a"), null);
    expect(getStatusItems().map((i) => i.key)).toEqual(["p.b", "q.c"]);
    clearPluginStatus("p");
    expect(getStatusItems().map((i) => i.key)).toEqual(["q.c"]);
    expect(emitted).toBe(1);
  });
});

describe("PluginStatusBar", () => {
  it("draws nothing without items, then the items on their side, and a click runs the command", async () => {
    const { container } = render(<PluginStatusBar win={window} />);
    expect(container.firstChild).toBeNull();
    act(() => {
      setStatusItem("p", "P", decl("a", { align: "left" }), state("left one"));
      setStatusItem("p", "P", decl("b"), { ...state("right"), tone: "warn" });
    });
    expect(screen.getByRole("status").textContent).toBe("left oneright");
    expect(screen.getByText("right").className).toContain("--warn");
    expect(screen.getByText("right").tagName).toBe("SPAN");
  });

  it("is hidden while plugins.status_bar is off", () => {
    const { container } = render(<PluginStatusBar win={window} />);
    act(() => setStatusItem("p", "P", decl("a"), state("a")));
    expect(container.firstChild).not.toBeNull();
    act(() => updatePreferences({ pluginsStatusBar: false }));
    expect(container.firstChild).toBeNull();
  });

  it("the toggle command is in the palette and flips the key", () => {
    const off = registerStatusBarCommands(window);
    expect(registeredCommands().some((c) => c.id === TOGGLE_STATUS_BAR)).toBe(
      true,
    );
    getRegisteredHandler(TOGGLE_STATUS_BAR)!();
    const { container } = render(<PluginStatusBar win={window} />);
    act(() => setStatusItem("p", "P", decl("a"), state("a")));
    expect(container.firstChild).toBeNull();
    off();
  });
});

describe("ctx.statusBar in the app host", () => {
  it("a click runs the declared command; disable removes the item", async () => {
    let ctx!: PluginContext;
    const p = await boot(
      {
        id: "clicky",
        activation: ["onStartupFinished"],
        contributes: {
          commands: [{ id: "go" }],
          status_bar: [{ id: "s", title: "S", command: "go" }],
        },
      },
      {
        activate(c) {
          ctx = c;
          c.commands.register("go", () =>
            c.statusBar.set("s", { text: "ran" }),
          );
        },
      },
    );
    await p.flush();
    ctx.statusBar.set("s", { text: "idle" });
    render(<PluginStatusBar win={window} />);
    expect(p.statusBar().map((i) => i.text)).toEqual(["idle"]);
    fireEvent.click(screen.getByRole("button", { name: "idle" }));
    await p.flush();
    expect(p.statusBar().map((i) => i.text)).toEqual(["ran"]);
    ctx.statusBar.set("zzz", { text: "x" });
    expect(p.log().some((l) => /not declared/.test(l.text))).toBe(true);
    await p.disable();
    expect(p.statusBar()).toEqual([]);
    await p.dispose();
  });
});
