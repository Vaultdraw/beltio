import { afterEach, describe, expect, it } from "vitest";

import { BUILTIN_COMMANDS } from "../commands/commands";
import { appCommandHandlers } from "../commands/useAppCommands";
import { resolveEntryState, ACTIVITY_ENTRIES } from "../activityBar/entries";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
  unknownKeyProblems,
} from "../vault/settingsSync";

import { setSafeStart } from "../safeStart/state";

import {
  EXTENSION_COMMAND_HANDLERS,
  restoreExtensionDefaults,
  toggleExtension,
} from "./extensionCommands";
import {
  EXTENSIONS_DEFAULTS_COMMAND_ID,
  extensionToggleCommandId,
} from "./extensionCommandDefs";
import { EXTENSION_DEFAULTS } from "./extensionSettings";
import { EXTENSION_FIELDS, EXTENSION_IDS, isExtensionId } from "./registry";
import { effectiveExtensions, getExtensions } from "./useExtensions";

import type { AppCommandActions } from "../commands/useAppCommands";

afterEach(() => {
  setSafeStart(null);
  restoreExtensionDefaults();
});

describe("[extensions] keys", () => {
  it("every extension is on by default (owner, 2026-10-24)", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    for (const id of EXTENSION_IDS) {
      expect(values[EXTENSION_FIELDS[id]]).toBe(true);
      expect(DEFAULT_PREFERENCES[EXTENSION_FIELDS[id]]).toBe(true);
    }
  });

  it("reads a switch per id, plugin-grammar ids included", () => {
    const { values, problems } = configToPreferences({
      extensions: { graph: false, "pdf-import": false },
    });
    expect(problems).toEqual([]);
    expect(values.extGraph).toBe(false);
    expect(values.extPdfImport).toBe(false);
    expect(values.extLinks).toBe(true);
  });

  it("rejects a non-boolean with a problem and keeps the default", () => {
    const { values, problems } = configToPreferences({
      extensions: { links: "no" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("extensions.links");
    expect(values.extLinks).toBe(true);
  });

  it("reports an unknown id with a suggestion", () => {
    const problems = unknownKeyProblems({ extensions: { grpah: false } });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("did you mean extensions.graph?");
  });

  it("writes a changed switch back as one dotted key", () => {
    const prev = normalizePreferences({});
    const next = { ...prev, extGraph: false };
    const changes = preferencesToConfigChanges(prev, next);
    expect(changes).toEqual([
      expect.objectContaining({ key: "extensions.graph", value: false }),
    ]);
  });

  it("stored preferences with a bad value fall back to the default", () => {
    expect(normalizePreferences({ extTags: "off" }).extTags).toBe(true);
    expect(normalizePreferences({ extTags: false }).extTags).toBe(false);
  });
});

describe("effective set", () => {
  it("follows the switches", () => {
    const set = effectiveExtensions(
      { ...EXTENSION_DEFAULTS, extSearch: false },
      false,
    );
    expect(set.search).toBe(false);
    expect(set.links).toBe(true);
  });

  it("is all off in safe start, whatever the switches say", () => {
    const set = effectiveExtensions(EXTENSION_DEFAULTS, true);
    expect(EXTENSION_IDS.every((id) => !set[id])).toBe(true);
  });

  it("keeps one snapshot object until a switch changes", () => {
    const a = getExtensions();
    expect(getExtensions()).toBe(a);
    updatePreferences({ extGraph: false });
    const b = getExtensions();
    expect(b).not.toBe(a);
    expect(b.graph).toBe(false);
    setSafeStart({
      reason: "flag",
      scope: "plugins",
      crashedLaunches: 0,
      pluginsAtCrash: [],
    });
    expect(getExtensions().links).toBe(true); // plugin-only safe mode
    setSafeStart({
      reason: "flag",
      scope: "core",
      crashedLaunches: 0,
      pluginsAtCrash: [],
    });
    expect(getExtensions().links).toBe(false);
  });

  it("ids follow the plugin id grammar", () => {
    for (const id of EXTENSION_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(isExtensionId(id)).toBe(true);
    }
    expect(isExtensionId("pdf_import")).toBe(false);
  });
});

describe("commands", () => {
  it("registers a rebindable toggle per extension and Restore defaults", () => {
    const ids = new Set(BUILTIN_COMMANDS.map((c) => c.id));
    for (const id of EXTENSION_IDS) {
      expect(ids).toContain(extensionToggleCommandId(id));
    }
    expect(ids).toContain(EXTENSIONS_DEFAULTS_COMMAND_ID);
  });

  it("every extension command has a handler in the app shell", () => {
    const handlers = appCommandHandlers({} as AppCommandActions);
    for (const id of Object.keys(EXTENSION_COMMAND_HANDLERS)) {
      expect(handlers[id]).toBeTypeOf("function");
    }
  });

  it("toggle flips the switch; Restore defaults turns everything back on", () => {
    toggleExtension("graph");
    expect(getPreferences().extGraph).toBe(false);
    toggleExtension("graph");
    expect(getPreferences().extGraph).toBe(true);
    toggleExtension("formula");
    toggleExtension("mermaid");
    restoreExtensionDefaults();
    expect(EXTENSION_IDS.every((id) => getExtensions()[id])).toBe(true);
  });

  it("gated app actions are not offered when the shell leaves them out", () => {
    const handlers = appCommandHandlers({} as AppCommandActions);
    expect(handlers["vault.newFromTemplate"]).toBeUndefined();
    expect(handlers["file.importPdf"]).toBeUndefined();
    expect(handlers["templates.saveDrawing"]).toBeUndefined();
    expect(handlers["navigator.searchTags"]).toBeUndefined();
  });
});

describe("activity bar", () => {
  const ctx = {
    drawingOpen: true,
    hasHandler: () => true,
    isAvailable: () => true,
    shortcut: () => "",
  };
  it("hides the entries of an extension that is off", () => {
    const graph = ACTIVITY_ENTRIES.find((e) => e.id === "graph")!;
    const library = ACTIVITY_ENTRIES.find((e) => e.id === "library")!;
    expect(resolveEntryState(graph, ctx).hidden).toBe(false);
    const off = { ...ctx, isExtensionOn: () => false, drawingOpen: false };
    expect(resolveEntryState(graph, off).hidden).toBe(true);
    // A needs-drawing entry is hidden too, not shown disabled.
    expect(resolveEntryState(library, off).hidden).toBe(true);
  });
});
