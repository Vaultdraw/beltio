/**
 * First-run setup: the step list, when it shows, every screen's writes,
 * skip at every step, back, keyboard only, Offline mode, the end action.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPreferences, updatePreferences } from "../vault/preferences";

import SetupWizard from "./SetupWizard";
import { FORCE_SETUP_FLAG, shouldShowFirstRun } from "./setupState";
import { closeSetup, isSetupRequested, requestSetup } from "./setupStore";
import { SETUP_STEPS } from "./steps";

const noop = () => undefined;

const mount = (over: Partial<React.ComponentProps<typeof SetupWizard>> = {}) => {
  const props = {
    win: window,
    hasVault: false,
    recentVaults: [] as string[],
    lastVaultPath: null,
    onOpenVault: vi.fn(),
    onCreateVault: vi.fn(),
    onSelectRecent: vi.fn(),
    refreshAppearance: vi.fn(),
    ...over,
  };
  render(<SetupWizard {...props} />);
  return props;
};

const wizard = () => screen.getByTestId("setup");
const stepId = () => wizard().getAttribute("data-step");
const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Get started|Open my vault|Finish|Choose a vault)/ }));
const goTo = (id: string) => {
  let guard = 0;
  while (stepId() !== id && guard++ < 10) {
    next();
  }
  expect(stepId()).toBe(id);
};

beforeEach(() => {
  window.localStorage.clear();
  (globalThis as Record<string, unknown>)[FORCE_SETUP_FLAG] = true;
});
afterEach(() => {
  cleanup();
  closeSetup();
  delete (globalThis as Record<string, unknown>)[FORCE_SETUP_FLAG];
});

describe("when the setup shows", () => {
  const base = { completed: false, recentVaults: [], lastVaultPath: null, testBuild: false };
  it.each([
    ["fresh start", base, true],
    ["already finished", { ...base, completed: true }, false],
    ["has a recent vault (older install)", { ...base, recentVaults: ["/a"] }, false],
    ["has a last vault", { ...base, lastVaultPath: "/a" }, false],
    ["perf or smoke build", { ...base, testBuild: true }, false],
  ])("%s", (_name, facts, expected) => {
    expect(shouldShowFirstRun(facts)).toBe(expected);
  });

  it("the command asks for it", () => {
    expect(isSetupRequested()).toBe(false);
    requestSetup();
    expect(isSetupRequested()).toBe(true);
  });
});

describe("the step list", () => {
  it("is Welcome, Look, Basics, Network, Extras, Vault, Done with unique ids", () => {
    expect(SETUP_STEPS.map((s) => s.id)).toEqual(["welcome", "look", "basics", "network", "extras", "vault", "done"]);
    expect(new Set(SETUP_STEPS.map((s) => s.id)).size).toBe(SETUP_STEPS.length);
  });
});

describe("walking through", () => {
  it("shows the pitch on the first screen and offers Skip setup but no Back", () => {
    mount();
    expect(stepId()).toBe("welcome");
    expect(screen.getByRole("heading", { name: /Your Excalidraw drawings, in a folder you own/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("Next and Back move one screen and keep what was chosen", () => {
    mount();
    goTo("basics");
    fireEvent.click(screen.getByRole("switch", { name: /Vim-style keys/ }));
    expect(getPreferences(window).notesVim).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(stepId()).toBe("look");
    next();
    expect((screen.getByRole("switch", { name: /Vim-style keys/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("Skip setup works on every screen except the last, and marks it done", () => {
    for (const step of SETUP_STEPS.slice(0, -1)) {
      window.localStorage.clear();
      const { unmount } = render(
        <SetupWizard win={window} hasVault={false} recentVaults={[]} lastVaultPath={null} onOpenVault={noop} onCreateVault={noop} onSelectRecent={noop} refreshAppearance={noop} />,
      );
      goTo(step.id);
      fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
      expect(getPreferences(window).onboardingCompleted).toBe(true);
      unmount();
    }
  });

  it("the last screen has no Skip setup (everything is done)", () => {
    mount();
    goTo("done");
    expect(screen.queryByRole("button", { name: "Skip setup" })).toBeNull();
  });
});

describe("each screen writes the config", () => {
  it("Look: mode, theme and accent", () => {
    const p = mount();
    goTo("look");
    fireEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(getPreferences(window).theme).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: /Nord/ }));
    expect(getPreferences(window).colorTheme).toBe("Nord");
    expect(p.refreshAppearance).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("radio", { name: /^Accent #/ })[0]!);
    expect(getPreferences(window).accentColor).toMatch(/^#[0-9a-f]{6}$/i);
    fireEvent.click(screen.getByRole("radio", { name: /theme's own/i }));
    expect(getPreferences(window).accentColor).toBe("");
  });

  it("Basics: vim, Markdown mode, saving, line style", () => {
    mount();
    goTo("basics");
    fireEvent.click(screen.getByRole("switch", { name: /Markdown mode/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Slow/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Clean/ }));
    const p = getPreferences(window);
    expect([p.markdownTyping, p.autosaveDelayMs, p.defaultRoughness]).toEqual([true, 5000, 0]);
  });

  it("Network: Offline mode on and off, and the browse link follows it", () => {
    mount();
    goTo("network");
    fireEvent.click(screen.getByRole("radio", { name: /Offline mode/ }));
    const on = getPreferences(window);
    expect(on.networkOffline).toBe(true);
    expect(screen.getAllByText("Off while Offline mode is on.").length).toBe(3);
    fireEvent.click(screen.getByRole("radio", { name: /^Online/ }));
    expect(getPreferences(window).networkOffline).toBe(false);
  });

  it("Look hides Browse while Offline mode is on", () => {
    updatePreferences({ networkOffline: true }, window);
    mount();
    goTo("look");
    expect(screen.queryByRole("button", { name: /Browse community themes/ })).toBeNull();
    expect(screen.getByText(/once Offline mode is off/)).toBeTruthy();
  });

  it("Extras: a switch per extra; the AI assistant stays off and has no switch", () => {
    mount();
    goTo("extras");
    expect(screen.getAllByRole("switch").length).toBe(6);
    const sw = screen.getByRole("switch", { name: /Graph view/ });
    fireEvent.click(sw);
    expect(getPreferences(window).extGraph).toBe(false);
    expect(getPreferences(window).aiEnabled).toBe(false);
    expect(screen.getByTestId("setup-ai-note").textContent).toMatch(/AI assistant: off/);
  });
});

describe("keyboard", () => {
  it("Enter goes next, Esc goes back, Esc on the first screen asks before skipping", () => {
    mount();
    fireEvent.keyDown(wizard(), { key: "Enter" });
    expect(stepId()).toBe("look");
    fireEvent.keyDown(wizard(), { key: "Escape" });
    expect(stepId()).toBe("welcome");
    fireEvent.keyDown(wizard(), { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Skip the setup?" })).toBeTruthy();
    fireEvent.keyDown(wizard(), { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Skip the setup?" })).toBeNull();
    expect(getPreferences(window).onboardingCompleted).toBe(false);
    fireEvent.keyDown(wizard(), { key: "Escape" });
    fireEvent.keyDown(wizard(), { key: "Enter" });
    expect(getPreferences(window).onboardingCompleted).toBe(true);
  });

  it("Enter on a focused button presses that button, not Next", () => {
    mount();
    const skip = screen.getByRole("button", { name: "Skip setup" });
    fireEvent.keyDown(skip, { key: "Enter" });
    expect(stepId()).toBe("welcome");
  });
});

describe("the vault step and the end", () => {
  const finishWith = async (choice: RegExp, props = mount()) => {
    goTo("vault");
    fireEvent.click(screen.getByRole("radio", { name: choice }));
    next();
    expect(stepId()).toBe("done");
    await act(async () => {
      next();
    });
    return props;
  };

  it("Open a folder opens the picker at the end, after everything else is saved", async () => {
    const p = await finishWith(/Open a folder/);
    expect(p.onOpenVault).toHaveBeenCalledTimes(1);
    expect(getPreferences(window).onboardingCompleted).toBe(true);
  });
  it("Create a new vault", async () => {
    const p = await finishWith(/Create a new vault/);
    expect(p.onCreateVault).toHaveBeenCalledTimes(1);
  });
  it("Obsidian vault opens the folder as it is", async () => {
    const p = await finishWith(/Obsidian/);
    expect(p.onOpenVault).toHaveBeenCalledTimes(1);
  });
  it("Decide later opens nothing", async () => {
    const p = await finishWith(/Decide later/);
    expect(p.onOpenVault).not.toHaveBeenCalled();
    expect(p.onCreateVault).not.toHaveBeenCalled();
    expect(isSetupRequested()).toBe(false);
  });
  it("a recent vault is listed, preselected when it was the last, and reopened", async () => {
    const p = mount({ recentVaults: ["/v/one", "/v/two"], lastVaultPath: "/v/two" });
    goTo("vault");
    expect((screen.getByRole("radio", { name: /\/v\/two/ }) as HTMLInputElement).checked).toBe(true);
    next();
    await act(async () => {
      next();
    });
    expect(p.onSelectRecent).toHaveBeenCalledWith("/v/two");
  });
  it("re-run with a vault open keeps it, opens nothing, and shows the summary", async () => {
    const p = mount({ hasVault: true });
    goTo("vault");
    expect((screen.getByRole("radio", { name: /Keep the vault/ }) as HTMLInputElement).checked).toBe(true);
    next();
    expect(screen.getByTestId("setup-summary").textContent).toMatch(/the open vault stays/);
    await act(async () => {
      next();
    });
    expect(p.onOpenVault).not.toHaveBeenCalled();
  });
  it("Done says where the settings are", () => {
    mount();
    goTo("done");
    expect(screen.getByText(/config\.toml/)).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
  });
});

describe("re-running keeps the current values", () => {
  it("opens on the values already in the config", () => {
    updatePreferences({ notesVim: true, autosaveDelayMs: 2000, theme: "dark" }, window);
    mount({ hasVault: true });
    goTo("basics");
    expect((screen.getByRole("switch", { name: /Vim-style keys/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Relaxed/ }) as HTMLInputElement).checked).toBe(true);
  });
});
