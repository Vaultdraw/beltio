import { afterEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { SettingsModal } from "../components/settings/SettingsModal";
import {
  getEditorDefaults,
  getPreferences,
  getTheme,
} from "../vault/preferences";
import {
  disposeSettings,
  initSettings,
  reloadSettings,
} from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

const mockVault: VaultInfo = {
  handle: "vault-settings-test",
  name: "My Settings Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

/** Theme cards only (colour swatches are radios too). */
const themeCards = () =>
  screen.getAllByRole("radio").filter((r) => r.hasAttribute("data-theme-key"));

describe("SettingsModal component and preference persistence", () => {
  it("renders the sidebar pages (with search) and opens on Appearance", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Drawing" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    // General holds About (and the config file in Tauri).
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Interface" })).toBeInTheDocument();
    // Hotkeys is a custom page, always listed.
    expect(screen.getByRole("tab", { name: "Hotkeys" })).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Colour theme")).toBeInTheDocument();
  });

  it("lists Mode, sync, accent, canvas pattern, then the theme grid", () => {
    render(
      <SettingsModal
        vault={mockVault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    const mode = screen.getByText("Mode");
    const sync = screen.getByText("Sync canvas with theme");
    const accent = screen.getByText("Accent");
    const pattern = screen.getByText("Canvas pattern");
    const colour = screen.getByRole("radiogroup", { name: "Colour theme" });
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(mode, sync)).toBe(true);
    expect(follows(sync, accent)).toBe(true);
    expect(follows(accent, pattern)).toBe(true);
    expect(follows(pattern, colour)).toBe(true);
  });

  it("Escape clears the theme search first and closes Settings only after", () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        ownerDocument={document}
      />,
    );
    const search = screen.getByRole("searchbox", {
      name: "Search colour themes",
    });
    const all = themeCards().length;
    const target = themeCards()[all - 1].getAttribute("aria-label")!;
    const query = target.toUpperCase();
    fireEvent.change(search, { target: { value: query } });
    const matches = themeCards().map((r) => r.getAttribute("aria-label")!);
    expect(matches).toContain(target);
    expect(matches.length).toBeLessThan(all);
    for (const name of matches) {
      expect(name.toUpperCase()).toContain(query);
    }

    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    expect(themeCards()).toHaveLength(all);

    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates and persists theme preference when toggling between themes", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    const modeGroup = screen.getByRole("group", { name: "Mode" });
    const darkBtn = within(modeGroup).getByRole("button", { name: "Dark" });
    fireEvent.click(darkBtn);

    expect(getTheme(window)).toBe("dark");
    expect(onThemeChanged).toHaveBeenCalledWith("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const lightBtn = within(modeGroup).getByRole("button", { name: "Light" });
    fireEvent.click(lightBtn);

    expect(getTheme(window)).toBe("light");
    expect(onThemeChanged).toHaveBeenCalledWith("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("navigates to the Drawing page and updates default font and stroke width", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        ownerDocument={document}
      />,
    );

    const defaultsTab = screen.getByRole("tab", { name: "Drawing" });
    fireEvent.click(defaultsTab);

    expect(screen.getByText("Default font family")).toBeInTheDocument();
    expect(screen.getByText("Default stroke width")).toBeInTheDocument();

    const boldBtn = screen.getByRole("button", { name: "Bold (4px)" });
    fireEvent.click(boldBtn);

    const updated = getEditorDefaults(window);
    expect(updated.defaultStrokeWidth).toBe(4);
  });

  it("navigates to Files and displays current vault folder", () => {
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();
    const onReveal = vi.fn();

    render(
      <SettingsModal
        vault={mockVault}
        onClose={onClose}
        onThemeChanged={onThemeChanged}
        onRevealVault={onReveal}
        ownerDocument={document}
      />,
    );

    const vaultTab = screen.getByRole("tab", { name: "Files" });
    fireEvent.click(vaultTab);

    expect(screen.getByTitle("/Users/test/Vault")).toBeInTheDocument();
    expect(screen.getByText("Autosave delay")).toBeInTheDocument();

    const revealBtn = screen.getByRole("button", {
      name: /reveal vault folder/i,
    });
    fireEvent.click(revealBtn);
    expect(onReveal).toHaveBeenCalled();
  });

  it("uses Excalidraw's real font ids, defaulting to Excalifont (5)", () => {
    window.localStorage.clear();
    render(
      <SettingsModal
        vault={mockVault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    const select = screen.getByDisplayValue(/Excalifont/) as HTMLSelectElement;
    expect(select.value).toBe("5");
    const ids = Array.from(select.options).map((o) => Number(o.value));
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 8]);
    fireEvent.change(select, { target: { value: "8" } });
    expect(getEditorDefaults(window).defaultFontFamily).toBe(8);
  });

  it("hides config folder controls in browser mode", () => {
    render(
      <SettingsModal
        vault={mockVault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.queryByTestId("settings-config-row")).toBeNull();
    expect(screen.getByTestId("settings-config-note")).toBeInTheDocument();
    expect(screen.queryByText(/open config folder/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^reload$/i })).toBeNull();
  });

  describe("with the config folder (Tauri)", () => {
    afterEach(() => {
      disposeSettings();
      window.localStorage.clear();
    });

    const setup = async () => {
      const config = {
        appearance: { mode: "light" },
        editor: { stroke_width: 2 },
      } as Record<string, Record<string, unknown>>;
      const invoke = vi.fn(async (cmd: string) => {
        if (cmd === "load_settings") {
          return {
            configDir: "/cfg",
            configPath: "/cfg/config.toml",
            statePath: "/state/state.json",
            config: JSON.parse(JSON.stringify(config)),
            configError: null,
            state: {},
          };
        }
        return undefined;
      });
      await initSettings(window, {
        tauri: true,
        invoke: invoke as any,
        listen: vi.fn(async () => () => {}) as any,
      });
      return { config, invoke };
    };

    it("shows the config path with Open config folder and Reload", async () => {
      const { invoke } = await setup();
      render(
        <SettingsModal
          vault={mockVault}
          onClose={vi.fn()}
          ownerDocument={document}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "General" }));
      expect(screen.getAllByTitle("/cfg/config.toml").length).toBeGreaterThan(
        0,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /open config folder/i }),
      );
      expect(invoke).toHaveBeenCalledWith("open_config_dir");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^reload$/i }));
      });
      expect(
        invoke.mock.calls.filter(([c]) => c === "load_settings"),
      ).toHaveLength(2);
      expect(await screen.findByRole("status")).toHaveTextContent(
        /up to date/i,
      );
    });

    it("refreshes displayed values when config.toml changes while open", async () => {
      const { config } = await setup();
      render(
        <SettingsModal
          vault={mockVault}
          onClose={vi.fn()}
          ownerDocument={document}
        />,
      );
      expect(
        within(screen.getByRole("group", { name: "Mode" })).getByRole(
          "button",
          {
            name: "Light",
          },
        ),
      ).toHaveClass("vault-segmented-btn--active");
      config.appearance.mode = "dark";
      config.editor.stroke_width = 4;
      await act(async () => {
        await reloadSettings();
      });
      expect(getPreferences(window).theme).toBe("dark");
      expect(
        within(screen.getByRole("group", { name: "Mode" })).getByRole(
          "button",
          {
            name: "Dark",
          },
        ),
      ).toHaveClass("vault-segmented-btn--active");
      fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
      expect(screen.getByRole("button", { name: "Bold (4px)" })).toHaveClass(
        "vault-segmented-btn--active",
      );
    });
  });
});
