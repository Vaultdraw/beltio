/**
 * Settings shell (phase 1): sidebar search across pages, controls that work
 * in place inside the results, Escape order, and Cmd+, from the app.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTING_CONTROLS } from "../components/settings/pages";
import {
  groupByPage,
  searchSettings,
  SETTINGS_SCHEMA,
} from "../components/settings/schema";
import { SettingsModal } from "../components/settings/SettingsModal";
import { VaultApp } from "../VaultApp";
import {
  getEditorDefaults,
  getPreferences,
  readLocalStoragePreferences,
} from "../vault/preferences";
import {
  disposeSettings,
  flushSettings,
  initSettings,
} from "../vault/settingsSync";

import { FakeVaultRepository } from "./fakeVaultRepository";
import { SAMPLE_SCENE } from "./fixtures";

import type { VaultInfo } from "../vault/types";

const mockVault: VaultInfo = {
  handle: "vault-settings-search",
  name: "Search Vault",
  path: "/Users/test/SearchVault",
  readOnly: false,
};

const renderModal = (onClose = vi.fn()) => {
  render(
    <SettingsModal
      vault={mockVault}
      onClose={onClose}
      ownerDocument={document}
    />,
  );
  return {
    onClose,
    search: screen.getByRole("searchbox", { name: "Search settings" }),
  };
};

const results = () => screen.getByRole("region", { name: /search results/i });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  disposeSettings();
  window.localStorage.clear();
});

describe("settings schema", () => {
  it("has a control for every row and a row for every control", () => {
    const ids = SETTINGS_SCHEMA.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SETTING_CONTROLS).sort()).toEqual([...ids].sort());
  });

  it("matches label, description, keywords and config key, all words", () => {
    const ids = (q: string) => searchSettings(q).map((s) => s.id);
    // Tool rows match their style keys too, so the Drawing row is one of many.
    expect(ids("stroke width")).toContain("stroke-width");
    expect(ids("stroke width")).toContain("tool-arrow");
    expect(ids("ATOMIC")).toEqual(["autosave"]); // description
    expect(ids("sloppiness")).toContain("roughness"); // keyword
    expect(ids("sloppiness")).toContain("tool-rectangle");
    expect(ids("saving.autosave_delay_ms")).toEqual(["autosave"]); // key
    expect(ids("ruled")).toEqual(["paper"]);
    expect(ids("dots")).toEqual(["paper"]);
    expect(ids("paper.style")).toEqual(["paper"]);
    expect(ids("   ")).toEqual([]);
    expect(ids("nothing-matches-this")).toEqual([]);
    const groups = groupByPage(searchSettings("colour"));
    expect(groups.map((g) => g.page.id)).toEqual([
      "appearance",
      "drawing",
      "tools",
      "links",
    ]);
  });
});

describe("settings search", () => {
  it("finds a setting on another page and hides the current page", () => {
    const { search } = renderModal();
    expect(screen.getByText("Mode")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "stroke width" } });

    const box = results();
    const drawing = within(box).getByRole("region", { name: "Drawing" });
    expect(within(drawing).getByText("Default stroke width")).toBeVisible();
    expect(within(box).queryByText("Mode")).toBeNull();
    expect(screen.queryByText("Colour theme")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Search results" }),
    ).toBeInTheDocument();
    // No page is selected while results are shown.
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
  });

  it("groups results by page in sidebar order", () => {
    const { search } = renderModal();
    fireEvent.change(search, { target: { value: "colour" } });
    const groups = within(results())
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label"));
    expect(groups).toEqual(["Appearance", "Drawing", "Tools", "Links"]);
  });

  it("editing a control in the results persists like on its page", () => {
    const { search } = renderModal();
    fireEvent.change(search, { target: { value: "stroke width" } });
    fireEvent.click(
      within(results()).getByRole("button", { name: "Bold (4px)" }),
    );
    expect(getEditorDefaults(window).defaultStrokeWidth).toBe(4);
    expect(readLocalStoragePreferences(window)?.defaultStrokeWidth).toBe(4);
    expect(
      within(results()).getByRole("button", { name: "Bold (4px)" }),
    ).toHaveClass("vault-segmented-btn--active");

    fireEvent.change(search, { target: { value: "sync canvas" } });
    fireEvent.click(
      within(results()).getByRole("switch", { name: /Sync canvas with theme/ }),
    );
    expect(getPreferences(window).syncCanvas).toBe(true);
  });

  it("writes config.toml from the results (Tauri)", async () => {
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "load_settings"
        ? {
            configDir: "/cfg",
            configPath: "/cfg/config.toml",
            statePath: "/state/state.json",
            config: { saving: { autosave_delay_ms: 500 } },
            configError: null,
            state: {},
          }
        : undefined,
    );
    await initSettings(window, {
      tauri: true,
      invoke: invoke as any,
      listen: vi.fn(async () => () => {}) as any,
    });
    const { search } = renderModal();
    // Tauri-only rows are searchable too.
    fireEvent.change(search, { target: { value: "config.toml" } });
    expect(
      within(results()).getAllByText("/cfg/config.toml").length,
    ).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: "autosave" } });
    const stepper = within(results()).getByRole("spinbutton", {
      name: "Autosave delay",
    });
    fireEvent.keyDown(stepper, { key: "PageUp" }); // 5 steps of 50 ms
    expect(getPreferences(window).autosaveDelayMs).toBe(750);
    await act(async () => {
      await flushSettings();
    });
    expect(invoke).toHaveBeenCalledWith("update_config", {
      changes: [{ key: "saving.autosave_delay_ms", value: 750 }],
    });
  });

  it("hides Tauri-only rows from results in the browser", () => {
    const { search } = renderModal();
    fireEvent.change(search, { target: { value: "folder" } });
    const box = results();
    expect(within(box).getByText("Vault folder")).toBeInTheDocument();
    expect(within(box).queryByText("Themes folder")).toBeNull();
    expect(within(box).queryByText("Config file")).toBeNull();
  });

  it("shows a message when nothing matches", () => {
    const { search } = renderModal();
    fireEvent.change(search, { target: { value: "zzz-no-such-setting" } });
    expect(within(results()).getByRole("status")).toHaveTextContent(
      /No settings match/,
    );
  });

  it("clearing the search returns to the current page", () => {
    const { search } = renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    fireEvent.change(search, { target: { value: "mode" } });
    expect(screen.queryByText("Default font family")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear settings search" }),
    );
    expect(search).toHaveValue("");
    expect(screen.getByRole("tab", { name: "Drawing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Default font family")).toBeInTheDocument();
  });

  it("a page tab or a result heading leaves the search and opens that page", () => {
    const { search } = renderModal();
    fireEvent.change(search, { target: { value: "autosave" } });
    fireEvent.click(within(results()).getByRole("button", { name: "Files" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.change(search, { target: { value: "autosave" } });
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(search).toHaveValue("");
    expect(
      screen.getByText(/Settings are saved in this browser/),
    ).toBeInTheDocument();
  });

  it("focuses the search box when Settings opens", () => {
    const { search } = renderModal();
    expect(search).toHaveFocus();
  });
});

describe("Escape order", () => {
  it("clears the settings search first, then closes", () => {
    const { search, onClose } = renderModal();
    fireEvent.change(search, { target: { value: "font" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Mode")).toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the search even when focus is elsewhere in Settings", () => {
    const { search, onClose } = renderModal();
    fireEvent.change(search, { target: { value: "stroke" } });
    const button = within(results()).getByRole("button", {
      name: "Bold (4px)",
    });
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("theme search (inside results) clears before the settings search", () => {
    const { search, onClose } = renderModal();
    fireEvent.change(search, { target: { value: "colour theme" } });
    const themeSearch = within(results()).getByRole("searchbox", {
      name: "Search colour themes",
    });
    fireEvent.change(themeSearch, { target: { value: "dracula" } });

    fireEvent.keyDown(themeSearch, { key: "Escape" });
    expect(themeSearch).toHaveValue("");
    expect(search).toHaveValue("colour theme");

    fireEvent.keyDown(themeSearch, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Escape claimed by the canvas", () => {
  // Excalidraw listens on document too (registered first) and
  // preventDefaults Escape to deselect or to commit a text edit.
  const claimEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
    }
  };
  beforeEach(() => document.addEventListener("keydown", claimEscape));
  afterEach(() => document.removeEventListener("keydown", claimEscape));

  it("a text field keeps its Escape; the canvas's claim still closes", () => {
    const editor = document.createElement("textarea");
    document.body.appendChild(editor);
    try {
      const { onClose } = renderModal();
      fireEvent.keyDown(editor, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      editor.remove();
    }
  });
});

/** The command registry binds Mod (Cmd on macOS, Ctrl elsewhere): pick one. */
const spoofPlatform = (platform: "Win32" | "MacIntel") => {
  const ua = platform === "Win32" ? "Windows" : "Macintosh";
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
};

describe("Cmd+, opens Settings", () => {
  const renderApp = async () => {
    const repo = new FakeVaultRepository();
    repo.seedDrawing("notes.excalidraw", SAMPLE_SCENE);
    render(<VaultApp repository={repo} initialVault={repo.vault} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Vault file navigator")).toBeInTheDocument(),
    );
  };
  const dialog = () => screen.queryByRole("dialog");

  it("opens with Cmd+, (macOS)", async () => {
    spoofPlatform("MacIntel");
    await renderApp();
    expect(dialog()).toBeNull();
    fireEvent.keyDown(document.body, {
      key: ",",
      code: "Comma",
      metaKey: true,
    });
    // The modal is a lazy chunk: it mounts after its import resolves.
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("searchbox", { name: "Search settings" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  it("opens with Ctrl+, (elsewhere)", async () => {
    spoofPlatform("Win32");
    await renderApp();
    fireEvent.keyDown(document.body, {
      key: ",",
      code: "Comma",
      ctrlKey: true,
    });
    await screen.findByRole("dialog");
  });

  it("ignores plain , and Cmd+Shift+, (Excalidraw's font size)", async () => {
    await renderApp();
    fireEvent.keyDown(document.body, { key: ",", code: "Comma" });
    fireEvent.keyDown(document.body, {
      key: "<",
      code: "Comma",
      metaKey: true,
      shiftKey: true,
    });
    expect(dialog()).toBeNull();
  });

  it("keeps focus (and the text) in an active text editor", async () => {
    await renderApp();
    // Stand-in for Excalidraw's wysiwyg textarea.
    const editor = document.createElement("textarea");
    editor.className = "excalidraw-wysiwyg";
    editor.value = "half-typed";
    document.body.appendChild(editor);
    editor.focus();
    try {
      const event = new KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        editor.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(dialog()).not.toBeNull();
      expect(editor).toHaveFocus();
      expect(editor.value).toBe("half-typed");
    } finally {
      editor.remove();
    }
  });
});
