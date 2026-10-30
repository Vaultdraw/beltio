import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { DEFAULT_LINKS_SETTINGS } from "../links/types";
import { SettingsModal } from "../components/settings/SettingsModal";
import { searchSettings, settingsForPage } from "../components/settings/schema";
import {
  DEFAULT_PREFERENCES,
  getLinksSettings,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "links-settings-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

const KEYS = [
  "links.new_link_format",
  "links.shape_link_format",
  "links.open_modifier",
  "links.update_on_rename",
  "links.autocomplete",
  "links.hint_chars",
  "links.style_links",
  "links.color",
  "links.hover_preview",
  "links.canvas_indicator",
  "tags.autocomplete",
  "tags.pane_sort",
] as const;

describe("links settings: config -> prefs -> config", () => {
  it("defaults come from DEFAULT_LINKS_SETTINGS", () => {
    expect(getLinksSettings(DEFAULT_PREFERENCES)).toEqual(
      DEFAULT_LINKS_SETTINGS,
    );
    const { values, problems } = configToPreferences({});
    expect(getLinksSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual(
      DEFAULT_LINKS_SETTINGS,
    );
    expect(problems.filter((p) => p.key?.startsWith("links."))).toEqual([]);
  });

  it("reads every valid value", () => {
    const { values, problems } = configToPreferences({
      links: {
        new_link_format: "relative",
        shape_link_format: "vaultdraw-url",
        open_modifier: "alt",
        update_on_rename: "ask",
        autocomplete: false,
        hint_chars: "jkl;",
        style_links: false,
        color: "#ff8800",
        hover_preview: "modifier",
        canvas_indicator: "both",
      },
    });
    expect(problems).toEqual([]);
    expect(getLinksSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual({
      newLinkFormat: "relative",
      shapeLinkFormat: "vaultdraw-url",
      openModifier: "alt",
      updateOnRename: "ask",
      autocomplete: false,
      hintChars: "jkl;",
      styleLinks: false,
      linkColor: "#ff8800",
      hoverPreview: "modifier",
      canvasIndicator: "both",
    });
  });

  it.each([true, false, "ask"])("accepts update_on_rename = %s", (v) => {
    const { values, problems } = configToPreferences({
      links: { update_on_rename: v },
    });
    expect(problems).toEqual([]);
    expect(values.linkUpdateOnRename).toBe(v);
  });

  it.each([
    ["new_link_format", "nearest"],
    ["shape_link_format", "html"],
    ["open_modifier", "meta"],
    ["update_on_rename", "sometimes"],
    ["autocomplete", "yes"],
    ["hint_chars", "a"],
    ["hint_chars", "aab"],
    ["hint_chars", "a b"],
    ["hint_chars", "ABC"],
    ["hint_chars", 5],
    ["style_links", "yes"],
    ["color", "red"],
    ["color", "#fff"],
    ["hover_preview", "sometimes"],
    ["canvas_indicator", "box"],
    ["canvas_indicator", true],
  ])("reports an invalid links.%s = %j and falls back", (name, value) => {
    const { values, problems } = configToPreferences({
      links: { [name]: value },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "invalid",
      key: `links.${name}`,
    });
    expect(getLinksSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual(
      DEFAULT_LINKS_SETTINGS,
    );
  });

  it("writes one change per changed key, and nothing when unchanged", () => {
    const next = {
      ...DEFAULT_PREFERENCES,
      linkNewFormat: "absolute" as const,
      linkShapeFormat: "vaultdraw-url" as const,
      linkOpenModifier: "ctrl" as const,
      linkUpdateOnRename: "ask" as const,
      linkAutocomplete: false,
      linkHintChars: "qwer",
      linkStyle: false,
      linkColor: "#ff8800",
      linkHoverPreview: "off" as const,
      linkCanvasIndicator: "icon" as const,
    };
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, next);
    expect(changes).toEqual([
      { key: "links.new_link_format", value: "absolute" },
      { key: "links.shape_link_format", value: "vaultdraw-url" },
      { key: "links.open_modifier", value: "ctrl" },
      { key: "links.update_on_rename", value: "ask" },
      { key: "links.autocomplete", value: false },
      { key: "links.hint_chars", value: "qwer" },
      { key: "links.style_links", value: false },
      { key: "links.color", value: "#ff8800" },
      { key: "links.hover_preview", value: "off" },
      { key: "links.canvas_indicator", value: "icon" },
    ]);
    expect(changes.map((c) => c.key)).toEqual(KEYS.slice(0, 10));
    expect(preferencesToConfigChanges(next, next)).toEqual([]);
  });

  it("round-trips through the config", () => {
    const next = {
      ...DEFAULT_PREFERENCES,
      linkNewFormat: "relative" as const,
      linkUpdateOnRename: false,
    };
    const config: Record<string, Record<string, unknown>> = { links: {} };
    for (const { key, value } of preferencesToConfigChanges(
      DEFAULT_PREFERENCES,
      next,
    )) {
      config.links[key.split(".")[1]] = value;
    }
    const { values, problems } = configToPreferences(config);
    expect(problems).toEqual([]);
    expect(getLinksSettings({ ...DEFAULT_PREFERENCES, ...values })).toEqual(
      getLinksSettings(next),
    );
  });

  it("normalizes stored prefs and falls back on bad values", () => {
    const prefs = normalizePreferences({
      linkNewFormat: "nope",
      linkHintChars: "x",
      linkUpdateOnRename: "ask",
    });
    expect(prefs.linkNewFormat).toBe("shortest");
    expect(prefs.linkHintChars).toBe("asdfghjkl");
    expect(prefs.linkUpdateOnRename).toBe("ask");
  });
});

describe("Links settings page", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("has a schema row with a config key for every setting", () => {
    const rows = settingsForPage("links");
    expect(rows.map((r) => r.configKey)).toEqual([...KEYS]);
    for (const row of rows) {
      expect(row.label && row.description && row.keywords.length).toBeTruthy();
    }
  });

  it("is searchable", () => {
    expect(searchSettings("hint").map((r) => r.id)).toContain(
      "link-hint-chars",
    );
    expect(searchSettings("wikilink").length).toBeGreaterThanOrEqual(2);
    expect(searchSettings("links.update_on_rename")).toHaveLength(1);
  });

  it("is listed after Files and renders its controls", () => {
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
        initialPage="links"
      />,
    );
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.indexOf("Links")).toBe(tabs.indexOf("Files") + 1);
    const panel = screen.getByRole("tabpanel");
    for (const label of [
      "New link format",
      "Shape link format",
      "Open link modifier",
      "Update links on rename",
      "Link suggestions",
      "Hint characters",
      "Style links in text",
      "Link colour",
      "Hover preview",
      "Link marker on the canvas",
    ]) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    // The Tags section shares the page: one more select and one more switch.
    expect(within(panel).getAllByRole("combobox")).toHaveLength(8);
    expect(within(panel).getAllByRole("switch")[0]).toBeChecked();
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
    const [format, shape, modifier, update, colorMode, hover, indicator] =
      within(panel).getAllByRole("combobox");
    fireEvent.change(format, { target: { value: "absolute" } });
    fireEvent.change(shape, { target: { value: "vaultdraw-url" } });
    fireEvent.change(modifier, { target: { value: "alt" } });
    fireEvent.change(update, { target: { value: "ask" } });
    fireEvent.click(within(panel).getAllByRole("switch")[0]);
    fireEvent.click(within(panel).getAllByRole("switch")[1]);
    fireEvent.change(colorMode, { target: { value: "custom" } });
    fireEvent.change(hover, { target: { value: "modifier" } });
    fireEvent.change(indicator, { target: { value: "both" } });
    const chars = within(panel).getByRole("textbox");
    fireEvent.change(chars, { target: { value: "a" } });
    fireEvent.blur(chars);
    expect(within(panel).getByRole("alert")).toBeInTheDocument();
    fireEvent.change(chars, { target: { value: "qwert" } });
    fireEvent.blur(chars);
    expect(getLinksSettings(getPreferences(window))).toEqual({
      newLinkFormat: "absolute",
      shapeLinkFormat: "vaultdraw-url",
      openModifier: "alt",
      updateOnRename: "ask",
      autocomplete: false,
      hintChars: "qwert",
      styleLinks: false,
      linkColor: "#6965db",
      hoverPreview: "modifier",
      canvasIndicator: "both",
    });
    fireEvent.change(update, { target: { value: "false" } });
    expect(getPreferences(window).linkUpdateOnRename).toBe(false);
    updatePreferences({}, window);
  });

  it("generates a settings.page.links command", async () => {
    const { getCommand } = await import("../commands/commands");
    expect(getCommand("settings.page.links")?.title).toBe("Settings: Links");
  });
});
