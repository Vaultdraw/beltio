/** Tool defaults: config mapping, per-vault layer, store, Settings page. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchSettings, SETTINGS_PAGES } from "../components/settings/schema";
import { SettingsModal } from "../components/settings/SettingsModal";
import { setSettingsScope } from "../components/settings/settingsScope";
import {
  TOOL_DEFAULT_TOOLS,
  toolField,
  TOOL_FIELDS,
} from "../toolDefaults/toolStyles";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  disposeSettings,
  preferencesToConfigChanges,
} from "../vault/settingsSync";
import {
  getEffectiveToolDefaults,
  resetToolDefault,
  saveToolDefault,
  subscribeToolDefaults,
  toolDefaultLayer,
} from "../vault/toolDefaultsStore";
import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
  parseVaultSettings,
  PER_VAULT_FIELDS,
  resolveSettings,
  setVaultOverride,
} from "../vault/vaultSettings";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "v",
  name: "V",
  path: "/v",
  readOnly: false,
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

describe("tool styles in config", () => {
  it("round-trips a tool table and orders its keys", () => {
    const { values, problems } = configToPreferences({
      tools: { arrow: { stroke_style: "dotted", stroke_color: "#f08c00" } },
    });
    expect(problems).toEqual([]);
    expect(Object.keys(values.toolArrow)).toEqual([
      "stroke_color",
      "stroke_style",
    ]);
    expect(values.toolRectangle).toEqual({});
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      ...values,
    });
    expect(changes).toEqual([
      {
        key: "tools.arrow",
        value: { stroke_color: "#f08c00", stroke_style: "dotted" },
      },
    ]);
  });

  it("falls back to {} for an invalid value; an unknown key is dropped and reported", () => {
    const bad = configToPreferences({
      tools: { arrow: { stroke_width: 99 }, line: { colour: "red" } },
    });
    expect(bad.values.toolArrow).toEqual({});
    expect(bad.values.toolLine).toEqual({});
    const messages = bad.problems.map((p) => p.message).join("\n");
    expect(messages).toContain("tools.arrow");
    expect(messages).toContain("stroke_width");
    expect(messages).toContain("unknown key tools.line.colour");
  });

  it("sends an emptied style as null", () => {
    const prev = {
      ...DEFAULT_PREFERENCES,
      toolText: { font_size: 28 as const },
    };
    expect(preferencesToConfigChanges(prev, DEFAULT_PREFERENCES)).toEqual([
      { key: "tools.text", value: null },
    ]);
  });

  it("normalizes stored preferences per tool", () => {
    const p = normalizePreferences({
      toolEllipse: { opacity: 50 },
      toolArrow: { nope: 1 },
      toolText: "x",
    });
    expect(p.toolEllipse).toEqual({ opacity: 50 });
    expect(p.toolArrow).toEqual({});
    expect(p.toolText).toEqual({});
  });
});

describe("tool styles per vault", () => {
  it("lists every tool field as per-vault", () => {
    for (const field of TOOL_FIELDS) {
      expect(PER_VAULT_FIELDS).toContain(field);
    }
  });

  it("parses (an empty table is a real override), ignores invalid, and resolves", () => {
    const { overrides, problems } = parseVaultSettings({
      tools: {
        arrow: { stroke_width: 3 },
        line: { stroke_width: 0 },
        text: {},
      },
    });
    expect(overrides).toEqual({ toolArrow: { stroke_width: 3 }, toolText: {} });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("tools.line");
    const global = Object.fromEntries(
      PER_VAULT_FIELDS.map((f) => [f, DEFAULT_PREFERENCES[f]]),
    ) as Parameters<typeof resolveSettings>[1];
    const effective = resolveSettings(overrides, global);
    expect(effective.toolArrow).toEqual({ stroke_width: 3 });
    expect(effective.toolLine).toEqual({});
    const withGlobal = resolveSettings(overrides, {
      ...global,
      toolText: { font_size: 28 },
    });
    expect(withGlobal.toolText).toEqual({});
  });

  it("keeps an empty override, removes on null, rejects invalid", async () => {
    await attachVaultSettings(window, "h", { tauri: false });
    expect(await setVaultOverride("toolArrow", { stroke_width: 3 })).toBe(true);
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toEqual({
      stroke_width: 3,
    });
    await setVaultOverride("toolArrow", {});
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toEqual({});
    await setVaultOverride("toolArrow", null);
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toBeUndefined();
    expect(await setVaultOverride("toolArrow", { stroke_width: 999 })).toBe(
      false,
    );
    expect(getVaultSettingsSnapshot().problems[0].message).toContain(
      "stroke_width",
    );
  });
});

describe("toolDefaultsStore", () => {
  it("saves to global without a vault override and resets it", async () => {
    await attachVaultSettings(window, "h", { tauri: false });
    expect(toolDefaultLayer("arrow")).toBe("global");
    expect(await saveToolDefault("arrow", { stroke_width: 3 })).toBe("global");
    expect(getPreferences(window).toolArrow).toEqual({ stroke_width: 3 });
    expect(getEffectiveToolDefaults()).toEqual({ arrow: { stroke_width: 3 } });
    expect(await resetToolDefault("arrow")).toBe("global");
    expect(getEffectiveToolDefaults()).toEqual({});
  });

  it("writes to the vault override when the tool is overridden there", async () => {
    updatePreferences({ toolArrow: { stroke_color: "#ff0000" } });
    await attachVaultSettings(window, "h", { tauri: false });
    await setVaultOverride("toolArrow", { stroke_width: 5 });
    expect(toolDefaultLayer("arrow")).toBe("vault");
    expect(getEffectiveToolDefaults().arrow).toEqual({ stroke_width: 5 });
    expect(await saveToolDefault("arrow", { stroke_width: 2 })).toBe("vault");
    expect(getPreferences(window).toolArrow).toEqual({
      stroke_color: "#ff0000",
    });
    expect(getEffectiveToolDefaults().arrow).toEqual({ stroke_width: 2 });
    expect(await resetToolDefault("arrow")).toBe("vault");
    // Reset keeps the (empty) override: this vault has no arrow defaults.
    expect(toolDefaultLayer("arrow")).toBe("vault");
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toEqual({});
    expect(getEffectiveToolDefaults().arrow).toBeUndefined();
    await setVaultOverride("toolArrow", null);
    expect(getEffectiveToolDefaults().arrow).toEqual({
      stroke_color: "#ff0000",
    });
    expect(toolDefaultLayer("arrow")).toBe("global");
  });

  it("notifies only when the effective defaults change", async () => {
    await attachVaultSettings(window, "h", { tauri: false });
    let calls = 0;
    const off = subscribeToolDefaults(() => calls++);
    updatePreferences({ zoom: 120 });
    expect(calls).toBe(0);
    updatePreferences({ toolLine: { opacity: 40 } });
    expect(calls).toBe(1);
    await setVaultOverride("toolLine", { opacity: 10 });
    expect(calls).toBe(2);
    off();
    await resetToolDefault("line");
    expect(calls).toBe(2);
  });
});

describe("settings schema", () => {
  it("has the Tool defaults page after Pens and a row per tool", () => {
    const ids = SETTINGS_PAGES.map((p) => p.id);
    expect(ids).toContain("tools");
    expect(ids).not.toContain("pens");
    expect(searchSettings("arrowhead").map((s) => s.id)).toContain(
      "tool-arrow",
    );
    expect(searchSettings("font").map((s) => s.id)).toContain("tool-text");
    const found = searchSettings("default style").map((s) => s.id);
    for (const tool of TOOL_DEFAULT_TOOLS) {
      expect(found).toContain(`tool-${tool}`);
    }
  });
});

describe("Tools page: tool defaults", () => {
  const open = async () => {
    await attachVaultSettings(window, "v", { tauri: false });
    render(
      <SettingsModal
        vault={vault}
        onClose={() => {}}
        ownerDocument={document}
        initialPage="tools"
      />,
    );
  };

  const tab = (name: string) =>
    fireEvent.click(screen.getByRole("tab", { name }));

  it("shows one tool section at a time with its controls", async () => {
    await open();
    expect(screen.getByTestId("tool-defaults-page")).toBeTruthy();
    // Rectangle is the default section; the others are not rendered.
    expect(screen.getByTestId("tool-default-rectangle")).toBeTruthy();
    expect(screen.queryByTestId("tool-default-arrow")).toBeNull();
    for (const tool of TOOL_DEFAULT_TOOLS) {
      tab(tool[0].toUpperCase() + tool.slice(1));
      expect(screen.getByTestId(`tool-default-${tool}`)).toBeTruthy();
    }
    tab("Arrow");
    expect(screen.getByTestId("tool-default-arrow-end_arrowhead")).toBeTruthy();
    tab("Text");
    expect(screen.getByTestId("tool-default-text-font_family")).toBeTruthy();
    tab("Rectangle");
    expect(
      screen.queryByTestId("tool-default-rectangle-arrow_type"),
    ).toBeNull();
  });

  it("edits a select, removes the key with Default, and resets", async () => {
    await open();
    tab("Arrow");
    const style = screen.getByTestId("tool-default-arrow-stroke_style");
    fireEvent.change(style, { target: { value: "dotted" } });
    expect(getPreferences(window).toolArrow).toEqual({
      stroke_style: "dotted",
    });
    const width = screen.getByTestId("tool-default-arrow-stroke_width");
    fireEvent.change(width, { target: { value: "3" } });
    fireEvent.blur(width);
    expect(getPreferences(window).toolArrow).toEqual({
      stroke_width: 3,
      stroke_style: "dotted",
    });
    fireEvent.change(screen.getByTestId("tool-default-arrow-roughness"), {
      target: { value: "2" },
    });
    expect(getPreferences(window).toolArrow.roughness).toBe(2);
    fireEvent.change(style, { target: { value: "" } });
    expect(getPreferences(window).toolArrow).toEqual({
      stroke_width: 3,
      roughness: 2,
    });
    fireEvent.change(width, { target: { value: "" } });
    fireEvent.blur(width);
    expect(getPreferences(window).toolArrow).toEqual({ roughness: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Reset Arrow" }));
    expect(getPreferences(window).toolArrow).toEqual({});
  });

  it("names the effective default font and explains how drawings use the defaults", async () => {
    await open();
    tab("Text");
    const select = screen.getByTestId(
      "tool-default-text-font_family",
    ) as HTMLSelectElement;
    expect(select.options[0].textContent).toMatch(/^Default \(\w[\w ]*\)$/);
    expect(screen.getByText(/font set on the Drawing page/)).toBeTruthy();
    expect(screen.getByTestId("tool-scope-note").textContent).toMatch(
      /applies to that drawing only/,
    );
  });

  it("clamps numbers and sets a colour", async () => {
    await open();
    tab("Line");
    const width = screen.getByTestId("tool-default-line-stroke_width");
    fireEvent.change(width, { target: { value: "500" } });
    fireEvent.blur(width);
    expect(getPreferences(window).toolLine.stroke_width).toBe(40);
    fireEvent.change(screen.getByTestId("tool-default-line-stroke_color"), {
      target: { value: "#f08c00" },
    });
    expect(getPreferences(window).toolLine.stroke_color).toBe("#f08c00");
  });

  const scopeVault = () =>
    fireEvent.click(screen.getByRole("radio", { name: "This vault" }));

  it("vault scope: edits create the override from the global style; Reset to global removes it", async () => {
    updatePreferences({ [toolField("arrow")]: { stroke_width: 3 } });
    await open();
    scopeVault();
    tab("Arrow");
    const panel = screen.getByTestId("tool-default-arrow");
    expect(panel).toHaveAttribute("data-scope-state", "inherited");
    await act(async () => {
      fireEvent.change(screen.getByTestId("tool-default-arrow-stroke_style"), {
        target: { value: "dashed" },
      });
    });
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toEqual({
      stroke_width: 3,
      stroke_style: "dashed",
    });
    expect(panel).toHaveAttribute("data-scope-state", "overridden");
    expect(getPreferences(window).toolArrow).toEqual({ stroke_width: 3 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset Arrow" }));
    });
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toEqual({});
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Reset Arrow to global" }),
      );
    });
    expect(getVaultSettingsSnapshot().overrides.toolArrow).toBeUndefined();
    expect(panel).toHaveAttribute("data-scope-state", "inherited");
  });

  it("vault scope with an empty global style: an edit stores only that key", async () => {
    await open();
    scopeVault();
    tab("Line");
    await act(async () => {
      fireEvent.change(screen.getByTestId("tool-default-line-opacity"), {
        target: { value: "40" },
      });
      fireEvent.blur(screen.getByTestId("tool-default-line-opacity"));
    });
    expect(getVaultSettingsSnapshot().overrides.toolLine).toEqual({
      opacity: 40,
    });
    expect(getPreferences(window).toolLine).toEqual({});
  });

  it("global scope shows the global style and notes a vault override", async () => {
    updatePreferences({ [toolField("arrow")]: { stroke_width: 3 } });
    await open();
    await setVaultOverride(toolField("arrow"), { stroke_width: 9 });
    tab("Arrow");
    const panel = screen.getByTestId("tool-default-arrow");
    expect(panel).toHaveAttribute("data-vault-override", "true");
    expect(screen.getByTestId("tool-default-arrow-stroke_width")).toHaveValue(
      3,
    );
  });
});
