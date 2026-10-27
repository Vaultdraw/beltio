import { afterEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, render, screen } from "@testing-library/react";

import { getCommand } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";

import { WindowControls } from "../components/WindowControls";

import { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences";
import { configToPreferences } from "./settingsSync";
import {
  applyChromeClass,
  CUSTOM_CHROME_CLASS,
  isCustomChrome,
  isWindowDecorations,
} from "./windowChrome";

const current = {
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
};
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => current }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).__VAULTDRAW_CHROME__;
  document.documentElement.classList.remove(CUSTOM_CHROME_CLASS);
});

describe("[window] decorations", () => {
  it("defaults to custom and accepts custom or native", () => {
    expect(DEFAULT_PREFERENCES.windowDecorations).toBe("custom");
    expect(isWindowDecorations("native")).toBe(true);
    expect(isWindowDecorations("custom")).toBe(true);
    expect(isWindowDecorations("both")).toBe(false);
    expect(
      configToPreferences({ window: { decorations: "native" } }).values
        .windowDecorations,
    ).toBe("native");
  });

  it("reports a bad value and falls back to custom", () => {
    const { values, problems } = configToPreferences({
      window: { decorations: "none" },
    });
    expect(values.windowDecorations).toBe("custom");
    expect(problems.map((p) => p.key)).toEqual(["window.decorations"]);
    expect(
      normalizePreferences({ windowDecorations: 5 }).windowDecorations,
    ).toBe("custom");
  });
});

describe("custom chrome flag", () => {
  it("is off unless the native side set it", () => {
    expect(isCustomChrome(window)).toBe(false);
    expect(applyChromeClass(document, window)).toBe(false);
    expect(
      document.documentElement.classList.contains(CUSTOM_CHROME_CLASS),
    ).toBe(false);
  });

  it("adds the class on <html> when the native side says custom", () => {
    (window as unknown as Record<string, unknown>).__VAULTDRAW_CHROME__ =
      "custom";
    expect(applyChromeClass(document, window)).toBe(true);
    expect(
      document.documentElement.classList.contains(CUSTOM_CHROME_CLASS),
    ).toBe(true);
  });
});

describe("WindowControls", () => {
  it("has three labelled buttons that call the window API", async () => {
    await act(async () => {
      render(<WindowControls />);
    });
    const steps = [
      ["Minimize window", current.minimize],
      ["Maximize window", current.toggleMaximize],
      ["Close window", current.close],
    ] as const;
    for (const [name, spy] of steps) {
      await act(async () => {
        screen.getByRole("button", { name }).click();
      });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    }
    expect(current.minimize).toHaveBeenCalledTimes(1);
    expect(current.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(current.close).toHaveBeenCalledTimes(1);
  });

  it("binds the two palette commands while mounted", async () => {
    expect(getCommand("window.minimize")?.title).toBe("Window: Minimize");
    expect(getCommand("window.toggleMaximize")).toBeTruthy();
    expect(getRegisteredHandler("window.minimize")).toBeUndefined();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<WindowControls />);
    });
    await act(async () => {
      await getRegisteredHandler("window.toggleMaximize")!();
      await getRegisteredHandler("window.minimize")!();
    });
    expect(current.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(current.minimize).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(getRegisteredHandler("window.minimize")).toBeUndefined();
  });

  it("shows Restore while the window is maximized", async () => {
    current.isMaximized.mockResolvedValueOnce(true);
    await act(async () => {
      render(<WindowControls />);
    });
    expect(screen.getByRole("button", { name: "Restore window" })).toBeTruthy();
  });
});
