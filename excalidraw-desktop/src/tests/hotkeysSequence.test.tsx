import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { isDispatcherPaused } from "../commands/dispatcher";
import { detectPlatform } from "../commands/keys";
import { SettingsModal } from "../components/settings/SettingsModal";
import { getPreferences, updatePreferences } from "../vault/preferences";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "hotkeys-seq-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

const mac = detectPlatform(window) === "mac";
const press = (init: KeyboardEventInit & { code: string; key: string }) =>
  fireEvent.keyDown(window, init);
const type = (letter: string) =>
  press({ code: `Key${letter.toUpperCase()}`, key: letter });

const hotkeys = () => getPreferences(window).hotkeys;
const row = () =>
  document.querySelector<HTMLElement>('[data-command-id="vault.newDrawing"]')!;

const startSequence = () => {
  fireEvent.click(
    screen.getByRole("button", { name: "Add hotkey for New drawing" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sequence" }));
};

describe("Hotkeys page: sequence recorder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ hotkeys: {} }, window);
    render(
      <SettingsModal
        vault={vault}
        onClose={vi.fn()}
        ownerDocument={document}
        initialPage="hotkeys"
      />,
    );
  });
  afterEach(() => {
    cleanup();
    updatePreferences({ hotkeys: {} }, window);
  });

  it("offers the Sequence chip only while recording a command", () => {
    expect(screen.queryByRole("button", { name: "Sequence" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add hotkey for New drawing" }),
    );
    expect(screen.getAllByRole("button", { name: "Sequence" })).toHaveLength(1);
  });

  it("records g r live, Backspace removes, Enter saves", () => {
    startSequence();
    expect(isDispatcherPaused()).toBe(true);
    type("g");
    type("r");
    const live = within(row()).getByRole("status");
    expect(
      Array.from(live.querySelectorAll("kbd")).map((k) => k.textContent),
    ).toEqual(["G", "R"]);
    press({ code: "Backspace", key: "Backspace" });
    expect(live.querySelectorAll("kbd")).toHaveLength(1);
    type("r");
    press({ code: "Enter", key: "Enter" });
    expect(hotkeys()["vault.newDrawing"]).toEqual(["Mod+N", "G R"]);
    expect(within(row()).queryByRole("status")).toBeNull();
    expect(
      within(row()).getByRole("button", {
        name: "Remove G R from New drawing",
      }),
    ).toBeInTheDocument();
    expect(isDispatcherPaused()).toBe(false);
  });

  it("Enter with nothing typed waits; Esc cancels and keeps Settings open", () => {
    startSequence();
    press({ code: "Enter", key: "Enter" });
    expect(within(row()).getByRole("status")).toBeInTheDocument();
    type("g");
    press({ code: "Escape", key: "Escape" });
    expect(within(row()).queryByRole("status")).toBeNull();
    expect(hotkeys()["vault.newDrawing"]).toBeUndefined();
    expect(screen.getByRole("tab", { name: "Hotkeys" })).toBeInTheDocument();
  });

  it("refuses a reserved first chord", () => {
    startSequence();
    press(
      mac
        ? { code: "KeyQ", key: "q", metaKey: true }
        : { code: "F4", key: "F4", altKey: true },
    );
    expect(within(row()).getByRole("alert")).toHaveTextContent(/Can't use/);
  });

  it("shows a prefix conflict for a recorded sequence", () => {
    act(() => {
      updatePreferences(
        { hotkeys: { "vault.newDrawing": ["g g"], "vault.switch": ["g"] } },
        window,
      );
    });
    expect(within(row()).getByTestId("conflict-sentence")).toHaveTextContent(
      /the sequence wins/,
    );
  });
});
