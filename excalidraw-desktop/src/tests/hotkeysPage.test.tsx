import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { isDispatcherPaused } from "../commands/dispatcher";
import { detectPlatform } from "../commands/keys";
import { SettingsModal } from "../components/settings/SettingsModal";
import { getPreferences, updatePreferences } from "../vault/preferences";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "hotkeys-page-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

const mac = detectPlatform(window) === "mac";
const MOD = mac ? { metaKey: true } : { ctrlKey: true };
const MOD_LABEL = mac ? "⌘" : "Ctrl+";

const press = (init: KeyboardEventInit & { code: string; key?: string }) =>
  fireEvent.keyDown(window, init);

const openPage = (onClose = vi.fn()) => {
  render(
    <SettingsModal
      vault={vault}
      onClose={onClose}
      ownerDocument={document}
      initialPage="hotkeys"
    />,
  );
  return onClose;
};

const start = (title: string) =>
  fireEvent.click(
    screen.getByRole("button", { name: `Add hotkey for ${title}` }),
  );

const hotkeys = () => getPreferences(window).hotkeys;
const SAVE_DEFAULTS = mac
  ? ["Mod+S", "Mod+Shift+S", "Ctrl+S"]
  : ["Mod+S", "Mod+Shift+S"];

describe("Hotkeys settings page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ hotkeys: {} }, window);
  });
  afterEach(() => {
    cleanup();
    updatePreferences({ hotkeys: {} }, window);
  });

  it("is listed in the sidebar and found by search", () => {
    render(
      <SettingsModal
        vault={vault}
        onClose={vi.fn()}
        ownerDocument={document}
      />,
    );
    expect(screen.getByRole("tab", { name: "Hotkeys" })).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search settings" }),
      {
        target: { value: "shortcut" },
      },
    );
    expect(screen.getByRole("button", { name: "Hotkeys" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hotkeys" }));
    expect(
      screen.getByRole("searchbox", { name: "Filter hotkeys" }),
    ).toBeTruthy();
  });

  it("opens on the page via initialPage and filters by text", () => {
    openPage();
    expect(screen.getByText("New drawing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter hotkeys"), {
      target: { value: "ZOOM" },
    });
    expect(screen.getByText("Zoom in (interface)")).toBeInTheDocument();
    expect(screen.queryByText("New drawing")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter hotkeys"), {
      target: { value: "vault.newdrawing" },
    });
    expect(screen.getByText("New drawing")).toBeInTheDocument();
  });

  it("records a new binding and removing/resetting restores the defaults", () => {
    openPage();
    start("New drawing");
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    press({ code: "KeyJ", key: "j", ...MOD });
    expect(hotkeys()["vault.newDrawing"]).toEqual(["Mod+N", "Mod+J"]);
    expect(screen.queryByText("Press keys…")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove ${MOD_LABEL}J from New drawing`,
      }),
    );
    expect(hotkeys()["vault.newDrawing"]).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Reset New drawing to default" }),
    ).toBeNull();
  });

  it("removes a default binding and resets it with the reset button", () => {
    openPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove ${MOD_LABEL}N from New drawing`,
      }),
    );
    expect(hotkeys()["vault.newDrawing"]).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset New drawing to default" }),
    );
    expect(hotkeys()["vault.newDrawing"]).toBeUndefined();
  });

  it("an override equal to the defaults deletes the key", () => {
    openPage();
    start("Save drawing");
    press({ code: "KeyJ", key: "j", ...MOD });
    expect(hotkeys()["file.save"]).toEqual([...SAVE_DEFAULTS, "Mod+J"]);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove ${MOD_LABEL}J from Save drawing`,
      }),
    );
    expect(hotkeys()["file.save"]).toBeUndefined();
  });

  it("lists every default chip; removing one default and resetting works", () => {
    openPage();
    const chips = () =>
      document.querySelectorAll(
        '.vault-hotkeys__row[data-command-id="file.save"] .vault-hotkeys__chip-key',
      );
    expect(chips()).toHaveLength(SAVE_DEFAULTS.length);
    // Defaults never count as conflicts, even with two chords per command.
    expect(screen.queryByRole("button", { name: /^Conflicts/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: mac
          ? "Remove ⌃S from Save drawing"
          : "Remove Ctrl+Shift+S from Save drawing",
      }),
    );
    expect(hotkeys()["file.save"]).toEqual(SAVE_DEFAULTS.slice(0, -1));
    expect(chips()).toHaveLength(SAVE_DEFAULTS.length - 1);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Save drawing to default" }),
    );
    expect(hotkeys()["file.save"]).toBeUndefined();
    expect(chips()).toHaveLength(SAVE_DEFAULTS.length);
  });

  it("Backspace clears every binding", () => {
    openPage();
    start("Zoom in (interface)");
    press({ code: "Backspace", key: "Backspace" });
    expect(hotkeys()["view.zoomIn"]).toEqual([]);
  });

  it("Escape cancels recording without closing Settings, and pauses the dispatcher", () => {
    const onClose = openPage();
    expect(isDispatcherPaused()).toBe(false);
    start("New drawing");
    expect(isDispatcherPaused()).toBe(true);
    press({ code: "Escape", key: "Escape" });
    expect(screen.queryByText("Press keys…")).toBeNull();
    expect(isDispatcherPaused()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(hotkeys()["vault.newDrawing"]).toBeUndefined();
  });

  it("ignores modifier-only presses and releases the pause on unmount", () => {
    openPage();
    start("New drawing");
    press({ code: "ShiftLeft", key: "Shift", shiftKey: true });
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    cleanup();
    expect(isDispatcherPaused()).toBe(false);
  });

  it("accepts a reserved chord and shows the clash with its reason", () => {
    openPage();
    start("New drawing");
    const quit = mac
      ? { code: "KeyQ", key: "q", ...MOD }
      : { code: "F4", key: "F4", altKey: true };
    press(quit);
    expect(hotkeys()["vault.newDrawing"]).toHaveLength(2);
    expect(screen.queryByText("Press keys…")).toBeNull();
    expect(
      document.querySelector('[data-testid="conflict-sentence"]')?.textContent,
    ).toMatch(/Change it/);
  });

  it("flags conflicts: count chip, red keys and a sentence saying which wins", () => {
    openPage();
    expect(screen.queryByRole("button", { name: /^Conflicts/ })).toBeNull();
    start("New drawing");
    press({ code: "Comma", key: ",", ...MOD });
    expect(hotkeys()["vault.newDrawing"]).toEqual(["Mod+N", "Mod+Comma"]);
    const chip = screen.getByRole("button", { name: /^Conflicts/ });
    expect(chip.textContent).toContain("2");
    expect(document.querySelectorAll('[data-conflict="true"]')).toHaveLength(2);
    const sentences = [
      ...document.querySelectorAll('[data-testid="conflict-sentence"]'),
    ].map((el) => el.textContent);
    expect(sentences).toHaveLength(2);
    expect(
      sentences.some((t) => t?.includes("Also bound to Open settings.")),
    ).toBe(true);
    expect(sentences.every((t) => /wins \(first match\)/.test(t ?? ""))).toBe(
      true,
    );
    expect(
      document.querySelectorAll(".vault-hotkeys__row--conflict"),
    ).toHaveLength(2);
    fireEvent.click(chip);
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(screen.queryByText("Save drawing")).toBeNull();
  });

  it("key capture filters commands bound to the pressed chord", () => {
    openPage();
    fireEvent.click(screen.getByRole("button", { name: "Record keys" }));
    expect(isDispatcherPaused()).toBe(true);
    press({ code: "KeyP", key: "p", ...MOD });
    expect(screen.getByText("Go to drawing")).toBeInTheDocument();
    expect(screen.queryByText("New drawing")).toBeNull();
    expect(isDispatcherPaused()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Clear key filter" }));
    expect(screen.getByText("New drawing")).toBeInTheDocument();
  });

  it("updates live when preferences change (hand-edited config)", () => {
    openPage();
    act(() => {
      updatePreferences({ hotkeys: { "vault.newDrawing": [] } }, window);
    });
    expect(
      screen.queryByRole("button", {
        name: `Remove ${MOD_LABEL}N from New drawing`,
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reset New drawing to default" }),
    ).toBeInTheDocument();
  });
});
