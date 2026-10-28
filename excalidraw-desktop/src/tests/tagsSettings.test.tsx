import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { SettingsModal } from "../components/settings/SettingsModal";
import { searchSettings } from "../components/settings/schema";
import { DEFAULT_TAGS_SETTINGS } from "../tags/types";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  getTagsSettings,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "tags-settings-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

describe("tags settings: config -> prefs -> config", () => {
  it("defaults follow DEFAULT_TAGS_SETTINGS", () => {
    expect(getTagsSettings(DEFAULT_PREFERENCES)).toEqual(DEFAULT_TAGS_SETTINGS);
    const { values, problems } = configToPreferences({});
    expect(getTagsSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual(
      DEFAULT_TAGS_SETTINGS,
    );
    expect(problems.filter((p) => p.key?.startsWith("tags."))).toEqual([]);
  });

  it("reads valid values and reports bad ones", () => {
    const ok = configToPreferences({
      tags: { autocomplete: false, pane_sort: "count" },
    });
    expect(ok.problems).toEqual([]);
    expect(getTagsSettings({ ...DEFAULT_PREFERENCES, ...ok.values })).toEqual({
      autocomplete: false,
      paneSort: "count",
    });
    const bad = configToPreferences({
      tags: { autocomplete: "yes", pane_sort: "size" },
    });
    expect(bad.problems.map((p) => p.key).sort()).toEqual([
      "tags.autocomplete",
      "tags.pane_sort",
    ]);
    expect(getTagsSettings({ ...DEFAULT_PREFERENCES, ...bad.values })).toEqual(
      DEFAULT_TAGS_SETTINGS,
    );
  });

  it("writes changed values back under [tags]", () => {
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      tagAutocomplete: false,
      tagPaneSort: "count",
    });
    const byKey = Object.fromEntries(changes.map((c) => [c.key, c.value]));
    expect(byKey["tags.autocomplete"]).toBe(false);
    expect(byKey["tags.pane_sort"]).toBe("count");
  });

  it("normalizePreferences drops garbage", () => {
    const n = normalizePreferences({ tagAutocomplete: 3, tagPaneSort: "x" });
    expect(getTagsSettings(n)).toEqual(DEFAULT_TAGS_SETTINGS);
  });

  it("the settings are searchable", () => {
    expect(searchSettings("hashtag").map((s) => s.id)).toContain(
      "tags-autocomplete",
    );
    expect(searchSettings("tags pane").map((s) => s.id)).toContain(
      "tags-pane-sort",
    );
  });
});

describe("tags settings: Links page", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("edits write to the preferences", () => {
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
        initialPage="links"
      />,
    );
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Tag suggestions")).toBeInTheDocument();
    expect(within(panel).getByText("Tags pane order")).toBeInTheDocument();
    fireEvent.click(within(panel).getAllByRole("switch")[2]);
    fireEvent.change(within(panel).getAllByRole("combobox")[6], {
      target: { value: "count" },
    });
    expect(getTagsSettings(getPreferences(window))).toEqual({
      autocomplete: false,
      paneSort: "count",
    });
    updatePreferences({}, window);
  });
});
