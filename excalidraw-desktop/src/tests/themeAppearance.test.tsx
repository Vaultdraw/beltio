import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsModal } from "../components/settings/SettingsModal";
import {
  isCanvasSyncActive,
  registerCanvasRepaint,
  resetCanvasSync,
  setCanvasSync,
  withStandardCanvasColors,
} from "../editor/canvasSync";
import {
  deriveTokens,
  EXCALIDRAW_OVERRIDE_STYLE_ID,
} from "../theme";
import { resetBuiltinCaches } from "../theme/builtins";
import {
  builtinRegistry,
  findTheme,
  setThemeRegistry,
} from "../theme/registry";
import {
  applyAppearance,
  computeAppearance,
  resetAppliedAppearance,
} from "../vault/appearance";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
} from "../vault/preferences";
import { useAppearance } from "../vault/useAppearance";

const { transforms, canvasBackgrounds } = vi.hoisted(() => ({
  transforms: [] as Array<((c: string, d: boolean) => string) | null>,
  canvasBackgrounds: [] as Array<string | null>,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  setDisplayColorTransform: (
    fn: ((c: string, d: boolean) => string) | null,
    canvasBackground: string | null = null,
  ) => {
    transforms.push(fn);
    canvasBackgrounds.push(canvasBackground);
  },
  invertColorForDarkMode: (c: string) => `inverted(${c})`,
}));

const dracula = findTheme(builtinRegistry(), "Dracula")!;
const lastTransform = () => transforms[transforms.length - 1];

const mockSystemDark = (dark: boolean) => {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => media) as any;
  return {
    set: (next: boolean) => {
      media.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
};

beforeEach(() => {
  window.localStorage.clear();
  transforms.length = 0;
  canvasBackgrounds.length = 0;
  mockSystemDark(false);
});

afterEach(() => {
  resetAppliedAppearance();
  resetCanvasSync();
  setThemeRegistry(null);
  document.documentElement.classList.remove("dark");
});

const root = () => document.documentElement;

/** Theme cards only (colour swatches are radios too). */
const themeCards = () =>
  screen.getAllByRole("radio").filter((r) => r.hasAttribute("data-theme-key"));

describe("computeAppearance + applyAppearance", () => {
  it("resolves system mode and the selected theme", () => {
    mockSystemDark(true);
    const s = computeAppearance(
      { theme: "system", colorTheme: "dracula", syncCanvas: false },
      builtinRegistry(),
      window,
    );
    expect(s.mode).toBe("dark");
    expect(s.entry.key).toBe("Dracula");
    expect(s.variant).toBe(dracula.theme.dark);
    expect(s.problem).toBeNull();
  });

  it("Default applies no tokens (stock look) but keeps html.dark in sync", () => {
    const s = computeAppearance(
      { theme: "dark", colorTheme: "Default", syncCanvas: false },
      builtinRegistry(),
      window,
    );
    applyAppearance(document, s);
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--vault-bg")).toBe("");
    expect(document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID)).toBeNull();
  });

  it("a theme sets tokens + Excalidraw vars; switching back restores", () => {
    const reg = builtinRegistry();
    applyAppearance(
      document,
      computeAppearance(
        { theme: "light", colorTheme: "Dracula", syncCanvas: false },
        reg,
        window,
      ),
    );
    const tokens = deriveTokens(dracula.theme.light, "light");
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.getPropertyValue("--vault-bg")).toBe(
      tokens["--vault-bg"],
    );
    expect(root().style.getPropertyValue("--vault-on-primary")).toBe(
      tokens["--vault-on-primary"],
    );
    expect(root().style.getPropertyValue("--vault-on-danger")).toMatch(/^#/);
    expect(
      document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID)?.textContent,
    ).toContain("--island-bg-color");

    // Mode change re-derives
    applyAppearance(
      document,
      computeAppearance(
        { theme: "dark", colorTheme: "Dracula", syncCanvas: false },
        reg,
        window,
      ),
    );
    expect(root().style.getPropertyValue("--vault-bg")).toBe(
      deriveTokens(dracula.theme.dark, "dark")["--vault-bg"],
    );

    applyAppearance(
      document,
      computeAppearance(
        { theme: "dark", colorTheme: "Default", syncCanvas: false },
        reg,
        window,
      ),
    );
    expect(root().style.getPropertyValue("--vault-bg")).toBe("");
    expect(root().style.getPropertyValue("--vault-on-danger")).toBe("");
    expect(document.getElementById(EXCALIDRAW_OVERRIDE_STYLE_ID)).toBeNull();
  });
});

describe("canvas sync", () => {
  it("installs the theme transform, repaints, and is idempotent per key", () => {
    const repaint = vi.fn();
    const off = registerCanvasRepaint(repaint);
    const variant = dracula.theme.light;
    expect(setCanvasSync({ variant, mode: "light", key: "a" })).toBe(true);
    expect(isCanvasSyncActive()).toBe(true);
    const fn = lastTransform()!;
    expect(fn("#ffffff", false)).toBe(variant.mSurface);
    expect(fn("#1e1e1e", false)).toBe(variant.mOnSurface);
    // Non-palette colours: unchanged in light, Excalidraw's inversion in dark
    // (the fallback must be invertColorForDarkMode, not applyDarkModeFilter).
    expect(fn("#123456", false)).toBe("#123456");
    expect(fn("#123456", true)).toBe("inverted(#123456)");
    expect(repaint).toHaveBeenCalledTimes(1);

    expect(setCanvasSync({ variant, mode: "light", key: "a" })).toBe(false);
    expect(repaint).toHaveBeenCalledTimes(1);

    expect(setCanvasSync(null)).toBe(true);
    expect(lastTransform()).toBeNull();
    expect(repaint).toHaveBeenCalledTimes(2);
    off();
  });

  it("pins the on-screen canvas background to the theme surface, whatever the file stores", async () => {
    const variant = dracula.theme.dark;
    setCanvasSync({ variant, mode: "dark", key: "bg" });
    expect(canvasBackgrounds.at(-1)).toBe(variant.mSurface);
    let during: unknown = "unset";
    await withStandardCanvasColors(async () => {
      during = canvasBackgrounds.at(-1);
    });
    // Exports: no override, so the file's own background colour is used.
    expect(during).toBeNull();
    expect(canvasBackgrounds.at(-1)).toBe(variant.mSurface);
    setCanvasSync(null);
    expect(canvasBackgrounds.at(-1)).toBeNull();
  });

  it("exports run with standard colours, then the transform comes back", async () => {
    const repaint = vi.fn();
    registerCanvasRepaint(repaint);
    setCanvasSync({ variant: dracula.theme.dark, mode: "dark", key: "d" });
    const active = lastTransform();
    let during: unknown = "unset";
    await withStandardCanvasColors(async () => {
      during = lastTransform();
    });
    expect(during).toBeNull();
    expect(lastTransform()).toBe(active);
    expect(repaint).toHaveBeenCalledTimes(2);
  });

  it("restores the transform even if the export fails", async () => {
    setCanvasSync({ variant: dracula.theme.dark, mode: "dark", key: "d" });
    const active = lastTransform();
    await expect(
      withStandardCanvasColors(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lastTransform()).toBe(active);
  });

  it("without sync, exports do not touch the transform", async () => {
    await withStandardCanvasColors(async () => undefined);
    expect(transforms).toHaveLength(0);
  });
});

describe("useAppearance wiring", () => {
  it("applies theme, mode, OS changes and sync from preferences", () => {
    const system = mockSystemDark(false);
    updatePreferences({
      theme: "system",
      colorTheme: "Dracula",
      syncCanvas: false,
    });
    const { result } = renderHook(() => useAppearance(document, window));
    expect(result.current.snapshot.mode).toBe("light");
    expect(root().dataset.vaultTheme).toBe("Dracula");
    expect(root().style.getPropertyValue("--vault-bg")).toBe(
      deriveTokens(dracula.theme.light, "light")["--vault-bg"],
    );
    expect(isCanvasSyncActive()).toBe(false);

    act(() => system.set(true));
    expect(result.current.snapshot.mode).toBe("dark");
    expect(root().classList.contains("dark")).toBe(true);

    act(() => {
      updatePreferences({ syncCanvas: true });
      result.current.refresh();
    });
    expect(isCanvasSyncActive()).toBe(true);
    expect(lastTransform()!("#ffffff", true)).toBe(dracula.theme.dark.mSurface);

    act(() => {
      updatePreferences({ colorTheme: "Default", syncCanvas: false });
      result.current.refresh();
    });
    expect(isCanvasSyncActive()).toBe(false);
    expect(root().style.getPropertyValue("--vault-bg")).toBe("");
  });

  it("shows Default and reports the repo name when the selected theme was removed from the app", () => {
    resetBuiltinCaches();
    updatePreferences({ theme: "dark", colorTheme: "Rose Pine Moon" });
    const { result } = renderHook(() => useAppearance(document, window));
    expect(root().dataset.vaultTheme).toBe("Default");
    expect(result.current.snapshot.removed).toBe("Rose Pine Moon");
    act(() => {
      updatePreferences({ colorTheme: "Dracula" });
      result.current.refresh();
    });
    expect(root().dataset.vaultTheme).toBe("Dracula");
    expect(result.current.snapshot.removed).toBeNull();
  });

  it("reports an unknown theme and uses Default", () => {
    updatePreferences({ theme: "light", colorTheme: "Missing" });
    const { result } = renderHook(() => useAppearance(document, window));
    expect(result.current.snapshot.entry.key).toBe("Default");
    expect(result.current.snapshot.problem).toMatch(/"Missing" was not found/);
  });
});

describe("Settings → Appearance", () => {
  it("picks a theme, toggles sync and disables the canvas background", () => {
    const onAppearanceChanged = vi.fn();
    render(
      <SettingsModal
        vault={null}
        onClose={() => {}}
        onAppearanceChanged={onAppearanceChanged}
        ownerDocument={document}
      />,
    );
    const cards = themeCards();
    expect(cards.length).toBe(builtinRegistry().themes.length);
    expect(screen.getByRole("radio", { name: "Default" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Dracula" }));
    expect(getPreferences().colorTheme).toBe("Dracula");
    expect(screen.getByRole("radio", { name: "Dracula" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(onAppearanceChanged).toHaveBeenCalledTimes(1);

    const sync = screen.getByRole("switch", { name: /Sync canvas with theme/ });
    expect(sync).not.toBeChecked();
    const bg = screen.getByTestId("settings-canvas-background");
    expect(bg.querySelector("fieldset")).not.toBeDisabled();
    fireEvent.click(sync);
    expect(getPreferences().syncCanvas).toBe(true);
    expect(bg.querySelector("fieldset")).toBeDisabled();
    expect(onAppearanceChanged).toHaveBeenCalledTimes(2);

    // Browser mode: no themes folder button
    expect(screen.queryByText("Open themes folder")).toBeNull();
  });

  it("shows user theme problems and the themes folder in Tauri", () => {
    const reg = {
      ...builtinRegistry("tauri"),
      fileProblems: [
        {
          id: "Bad",
          path: "/t/Bad.json",
          kind: "error" as const,
          message: 'Theme "Bad": not valid JSON (x)',
        },
      ],
    };
    render(
      <SettingsModal
        vault={null}
        onClose={() => {}}
        themeRegistry={reg}
        ownerDocument={document}
      />,
    );
    expect(
      screen.getByText('Theme "Bad": not valid JSON (x)'),
    ).toBeInTheDocument();
    expect(screen.getByText("Open themes folder")).toBeInTheDocument();
    expect(
      screen.getByText(/Drop Noctalia palettes \(\.json\) here/),
    ).toBeInTheDocument();
  });

  it("starts from DEFAULT_PREFERENCES (Default, sync off)", () => {
    expect(DEFAULT_PREFERENCES.colorTheme).toBe("Default");
    expect(DEFAULT_PREFERENCES.syncCanvas).toBe(false);
  });
});
