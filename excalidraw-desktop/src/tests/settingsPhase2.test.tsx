/**
 * Settings phase 2: accent, zoom, confirm-delete, per-vault rows, search
 * discovery and the navigator's sort menu / delete confirmation.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VaultNavigator } from "../components/VaultNavigator";
import { searchSettings } from "../components/settings/schema";
import { SettingsModal } from "../components/settings/SettingsModal";
import {
  getSettingsScope,
  setSettingsScope,
} from "../components/settings/settingsScope";
import { getPreferences } from "../vault/preferences";
import { disposeSettings } from "../vault/settingsSync";
import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
  setVaultOverride,
} from "../vault/vaultSettings";

import type { ComponentProps } from "react";

import type { VaultEntry, VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "p2",
  name: "P2 Vault",
  path: "/Users/test/P2",
  readOnly: false,
};

const renderModal = (v: VaultInfo | null = vault) => {
  render(
    <SettingsModal vault={v} onClose={vi.fn()} ownerDocument={document} />,
  );
  return screen.getByRole("searchbox", { name: "Search settings" });
};

beforeEach(() => {
  window.localStorage.clear();
  setSettingsScope("global");
});
afterEach(() => {
  detachVaultSettings();
  disposeSettings();
  window.localStorage.clear();
});

describe("phase 2 settings are discoverable", () => {
  it.each([
    ["trash", "confirm-delete"],
    ["zoom", "interface-zoom"],
    ["accent", "accent-colour"],
    ["sort", "sort-order"],
    ["inbox", "new-drawing-folder"],
  ])("search %s finds %s from another page", (query, id) => {
    expect(searchSettings(query).map((s) => s.id)).toContain(id);
    const search = renderModal();
    fireEvent.change(search, { target: { value: query } });
    expect(
      screen
        .getByRole("region", { name: /search results/i })
        .querySelector(`[data-setting-id="${id}"]`),
    ).not.toBeNull();
  });

  it("shows the Interface page", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: "Interface" })).toBeInTheDocument();
  });
});

describe("accent, zoom and confirm-delete controls", () => {
  it("sets and resets the accent colour", () => {
    renderModal();
    const hex = screen.getByLabelText("Accent colour hex");
    fireEvent.change(hex, { target: { value: "#336699" } });
    fireEvent.blur(hex);
    expect(getPreferences(window).accentColor).toBe("#336699");
    // The theme's own swatch (first) clears the override.
    fireEvent.click(screen.getByRole("button", { name: "Theme accent" }));
    expect(getPreferences(window).accentColor).toBe("");
  });

  it("does not save an invalid accent", () => {
    renderModal();
    const hex = screen.getByLabelText("Accent colour hex");
    fireEvent.change(hex, { target: { value: "nope" } });
    fireEvent.blur(hex);
    expect(getPreferences(window).accentColor).toBe("");
  });

  it("zoom slider writes the preference and reset restores 100", () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Interface" }));
    fireEvent.change(screen.getByLabelText("Interface zoom"), {
      target: { value: "130" },
    });
    expect(getPreferences(window).zoom).toBe(130);
    expect(screen.getByText("130 %")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Interface zoom" }),
    );
    expect(getPreferences(window).zoom).toBe(100);
  });

  it("confirm before delete toggles the preference", () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    const toggle = screen.getByRole("switch", {
      name: "Confirm before trashing",
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(getPreferences(window).confirmDelete).toBe(false);
  });
});

describe("per-vault rows", () => {
  const scopeRadio = (name: "Global" | "This vault") =>
    screen.getByRole("radio", { name });

  it("an edit in vault scope stores the override; Reset to global removes it", async () => {
    await attachVaultSettings(window, vault.handle);
    renderModal();
    fireEvent.click(scopeRadio("This vault"));
    fireEvent.click(screen.getByRole("tab", { name: "Interface" }));
    const row = () =>
      document.querySelector<HTMLElement>('[data-setting-id="sort-order"]')!;
    expect(row()).toHaveAttribute("data-scope-state", "inherited");
    expect(
      within(row()).getByText("Inherited from global"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Reset Navigator sort order to global",
      }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Navigator sort order"), {
      target: { value: "modified_desc" },
    });
    await waitFor(() =>
      expect(getVaultSettingsSnapshot().overrides.navigatorSort).toBe(
        "modified_desc",
      ),
    );
    expect(getPreferences(window).navigatorSort).toBe("name_asc");
    expect(row()).toHaveAttribute("data-scope-state", "overridden");
    expect(screen.getByText("Overridden")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Navigator sort order to global",
      }),
    );
    await waitFor(() =>
      expect(
        getVaultSettingsSnapshot().overrides.navigatorSort,
      ).toBeUndefined(),
    );
    expect(row()).toHaveAttribute("data-scope-state", "inherited");
  });

  it("global scope edits config, leaves the override alone and notes it", async () => {
    await attachVaultSettings(window, vault.handle);
    await setVaultOverride("navigatorSort", "modified_desc");
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Interface" }));
    const row = document.querySelector<HTMLElement>(
      '[data-setting-id="sort-order"]',
    )!;
    expect(row).toHaveAttribute("data-vault-override", "true");
    expect(
      screen.getByText(
        "Overridden in this vault: the vault value is used here",
      ),
    ).toBeInTheDocument();
    // The control shows the global value, not the vault's.
    expect(screen.getByLabelText("Navigator sort order")).toHaveValue(
      "name_asc",
    );
    fireEvent.change(screen.getByLabelText("Navigator sort order"), {
      target: { value: "name_desc" },
    });
    expect(getPreferences(window).navigatorSort).toBe("name_desc");
    expect(getVaultSettingsSnapshot().overrides.navigatorSort).toBe(
      "modified_desc",
    );
  });

  it("restore-default is a global-scope control only", async () => {
    await attachVaultSettings(window, vault.handle);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getAllByRole("button", { name: /^Reset Version interval/ })[0],
    ).toHaveAttribute("title", "Restore default");
    fireEvent.click(scopeRadio("This vault"));
    expect(screen.queryByTitle("Restore default")).toBeNull();
  });

  it("hides the scope switch without a vault", () => {
    renderModal(null);
    expect(screen.queryByTestId("settings-scope")).toBeNull();
  });

  it("disables the This vault radio for a read-only vault", () => {
    renderModal({ ...vault, readOnly: true });
    const radio = scopeRadio("This vault");
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).toHaveAttribute(
      "title",
      "This vault is read-only, so vault settings can't be saved",
    );
    expect(radio.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(radio);
    expect(scopeRadio("Global")).toHaveAttribute("aria-checked", "true");
  });

  it("the scope switch is a roving radiogroup", () => {
    renderModal();
    const group = screen.getByRole("radiogroup", { name: "Settings scope" });
    expect(scopeRadio("Global")).toHaveAttribute("tabindex", "0");
    expect(scopeRadio("This vault")).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(scopeRadio("Global"), { key: "ArrowRight" });
    expect(scopeRadio("This vault")).toHaveAttribute("aria-checked", "true");
    expect(group.ownerDocument.activeElement).toBe(scopeRadio("This vault"));
    fireEvent.keyDown(scopeRadio("This vault"), { key: "Home" });
    expect(scopeRadio("Global")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(scopeRadio("Global"), { key: "End" });
    expect(scopeRadio("This vault")).toHaveAttribute("aria-checked", "true");
  });

  it("vault scope lists only per-vault pages and filters search", () => {
    const search = renderModal();
    expect(screen.getByRole("tab", { name: "Hotkeys" })).toBeInTheDocument();
    fireEvent.click(scopeRadio("This vault"));
    expect(screen.queryByRole("tab", { name: "Hotkeys" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "General" })).toBeNull();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(
      screen.getByText(/apply to this vault only and override the global/),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zoom" } });
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "sort" } });
    expect(
      document.querySelector('[data-setting-id="sort-order"]'),
    ).not.toBeNull();
  });

  it("vault scope shows only styled tools on the Tools page", () => {
    renderModal();
    fireEvent.click(scopeRadio("This vault"));
    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));
    expect(screen.queryByRole("tab", { name: "Pen" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Laser" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Arrow" })).toBeInTheDocument();
  });

  it("opening at a global-only target switches to Global", () => {
    setSettingsScope("vault");
    render(
      <SettingsModal
        vault={vault}
        onClose={vi.fn()}
        ownerDocument={document}
        initialPage="hotkeys"
      />,
    );
    expect(scopeRadio("Global")).toHaveAttribute("aria-checked", "true");
    expect(getSettingsScope()).toBe("global");
  });

  it("the scope is remembered between openings", () => {
    renderModal();
    fireEvent.click(scopeRadio("This vault"));
    cleanup();
    renderModal();
    expect(scopeRadio("This vault")).toHaveAttribute("aria-checked", "true");
  });

  it("validates the default folder and normalises slashes", async () => {
    await attachVaultSettings(window, vault.handle);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    const input = screen.getByLabelText("Default folder for new drawings");
    fireEvent.change(input, { target: { value: "../escape" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(getPreferences(window).newDrawingFolder).toBe("");

    fireEvent.change(input, { target: { value: " /Inbox/Sketches/ " } });
    fireEvent.blur(input);
    expect(getPreferences(window).newDrawingFolder).toBe("Inbox/Sketches");
  });

  it("validates the templates folder and rejects an empty value", async () => {
    await attachVaultSettings(window, vault.handle);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    const input = screen.getByLabelText("Templates folder");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(getPreferences(window).templatesFolder).toBe("Templates");

    fireEvent.change(input, { target: { value: " /Shared/Tpl/ " } });
    fireEvent.blur(input);
    expect(getPreferences(window).templatesFolder).toBe("Shared/Tpl");
  });
});

describe("VaultNavigator sort and delete", () => {
  const entry: VaultEntry = {
    path: "a.excalidraw",
    name: "a",
    kind: "drawing",
    modifiedAt: 1,
    size: 1,
  };
  const props = (
    over: Partial<ComponentProps<typeof VaultNavigator>> = {},
  ): ComponentProps<typeof VaultNavigator> => ({
    vault,
    activePath: null,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onOpenDrawing: vi.fn(),
    onCreateDrawing: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameEntry: vi.fn(),
    onMoveEntry: vi.fn(),
    onDuplicateDrawing: vi.fn(),
    onTrashEntry: vi.fn(),
    onRevealEntry: vi.fn(),
    onSwitchVault: vi.fn(),
    treeNodes: [{ entry, children: [] } as never],
    expandedFolders: new Set(),
    onToggleFolder: vi.fn(),
    onExpandFolder: vi.fn(),
    allIndexedEntries: [entry],
    sortOrder: "name_asc",
    onSortChange: vi.fn(),
    confirmDelete: true,
    ...over,
  });

  it("the sort menu marks the active order and reports a change", () => {
    const p = props({ sortOrder: "modified_desc" });
    render(<VaultNavigator {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort order" }));
    expect(
      screen.getByRole("menuitemradio", { name: "Modified (new to old)" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Name (Z to A)" }),
    );
    expect(p.onSortChange).toHaveBeenCalledWith("name_desc");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drawing rows offer Export as PNG/SVG and Save a copy; folders don't", () => {
    const onExportDrawing = vi.fn();
    const folder: VaultEntry = {
      ...entry,
      path: "F",
      name: "F",
      kind: "folder",
    };
    render(
      <VaultNavigator
        {...props({
          onExportDrawing,
          treeNodes: [
            { entry: folder, children: [] } as never,
            { entry, children: [] } as never,
          ],
        })}
      />,
    );
    fireEvent.contextMenu(screen.getByText("F"));
    expect(
      screen.queryByRole("menuitem", { name: /Export as PNG/ }),
    ).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByText("a"));
    for (const [label, format] of [
      ["Export as PNG…", "png"],
      ["Export as SVG…", "svg"],
      ["Export as PDF…", "pdf"],
      ["Save a copy…", "copy"],
    ]) {
      if (!screen.queryByRole("menu")) {
        fireEvent.contextMenu(screen.getByText("a"));
      }
      // The export items sit in the "Export" submenu.
      fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(onExportDrawing).toHaveBeenLastCalledWith("a.excalidraw", format);
    }
  });

  const openTrash = () => {
    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Move to Trash/ }));
  };

  it("asks first when confirmDelete is on", async () => {
    const p = props();
    render(<VaultNavigator {...p} />);
    openTrash();
    expect(p.onTrashEntry).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });
    expect(p.onTrashEntry).toHaveBeenCalledWith("a.excalidraw");
  });

  it("trashes immediately when confirmDelete is off", () => {
    const p = props({ confirmDelete: false });
    render(<VaultNavigator {...p} />);
    openTrash();
    expect(p.onTrashEntry).toHaveBeenCalledWith("a.excalidraw");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
