/** Settings → Extensions: rows, switches write the keys, safe start note, defaults. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsModal } from "../components/settings/SettingsModal";
import { restoreExtensionDefaults } from "../extensionSwitches/extensionCommands";
import { BUILTIN_EXTENSIONS } from "../extensionSwitches/registry";
import { setSafeStart } from "../safeStart/state";
import { getPreferences } from "../vault/preferences";
import { disposeSettings } from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "h",
  name: "V",
  path: "/v",
  readOnly: false,
};

afterEach(() => {
  cleanup();
  setSafeStart(null);
  restoreExtensionDefaults();
  disposeSettings();
  window.localStorage.clear();
});

const open = async () => {
  await act(async () => {
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
        initialPage="extensions"
      />,
    );
  });
  return screen.findByTestId("settings-extensions");
};

describe("Settings → Extensions", () => {
  it("lists every extension, history, thumbnails and the index", async () => {
    const page = await open();
    for (const e of BUILTIN_EXTENSIONS) {
      expect(within(page).getByTestId(`extension-row-${e.id}`)).toBeTruthy();
    }
    for (const id of ["history", "thumbnails", "index"]) {
      expect(within(page).getByTestId(`extension-row-${id}`)).toBeTruthy();
    }
  });

  it("a switch writes its key; the index row follows", async () => {
    const page = await open();
    fireEvent.click(within(page).getByRole("switch", { name: "Graph view" }));
    expect(getPreferences().extGraph).toBe(false);
    fireEvent.click(within(page).getByRole("switch", { name: "Thumbnails" }));
    expect(getPreferences().thumbnails).toBe(false);
    for (const name of ["Full-text search", "Tags", "Links"]) {
      fireEvent.click(within(page).getByRole("switch", { name }));
    }
    expect(
      within(page).getByTestId("extension-row-index").textContent,
    ).toContain("Not needed");
    fireEvent.click(
      within(page).getByRole("button", { name: "Restore defaults" }),
    );
    expect(getPreferences().extLinks).toBe(true);
    expect(
      (
        within(page).getByRole("switch", {
          name: "Graph view",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("shows the off note of Links when it is off", async () => {
    const page = await open();
    fireEvent.click(within(page).getByRole("switch", { name: "Links" }));
    expect(
      within(page).getByTestId("extension-row-links").textContent,
    ).toContain("Renaming still updates links");
  });

  it("says so in a core safe start", async () => {
    setSafeStart({
      reason: "flag",
      scope: "core",
      crashedLaunches: 0,
      pluginsAtCrash: [],
    });
    const page = await open();
    expect(within(page).getByRole("status").textContent).toContain(
      "started with --safe",
    );
  });
});
