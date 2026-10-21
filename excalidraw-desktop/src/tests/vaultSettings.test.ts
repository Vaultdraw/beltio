import { afterEach, describe, expect, it, vi } from "vitest";

import { HISTORY_DEFAULTS } from "../history/historySettings";
import {
  DEFAULT_PREFERENCES,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  attachVaultSettings,
  detachVaultSettings,
  getVaultSettingsSnapshot,
  parseVaultSettings,
  resolveSetting,
  resolveSettings,
  setVaultOverride,
  subscribeVaultSettings,
} from "../vault/vaultSettings";

type Files = Record<string, any>;

const createBackend = (files: Files = {}) => {
  const b = {
    files,
    errors: {} as Record<string, any>,
    writeError: null as any,
    handler: null as null | ((e: { payload: unknown }) => void),
    unlisten: vi.fn(),
    invoke: vi.fn(async (cmd: string, args?: Record<string, any>) => {
      const file = b.files[args!.handle];
      if (cmd === "load_vault_settings") {
        const err = b.errors[args!.handle];
        return {
          path: "/v/.excalidraw-vault/settings.toml",
          settings: err ? null : JSON.parse(JSON.stringify(file ?? {})),
          settingsError: err ?? null,
        };
      }
      if (cmd === "update_vault_settings") {
        if (b.writeError) {
          throw b.writeError;
        }
        b.files[args!.handle] ??= {};
        for (const { key, value } of args!.changes) {
          const [t, n] = key.split(".");
          const f = b.files[args!.handle];
          f[t] ??= {};
          if (value === null) {
            delete f[t][n];
          } else {
            f[t][n] = value;
          }
        }
        return undefined;
      }
      throw new Error(`unknown ${cmd}`);
    }),
    listen: vi.fn(async (event: string, handler: any) => {
      expect(event).toBe("vault-settings-change");
      b.handler = handler;
      return b.unlisten;
    }),
    emit: (handle: string) => b.handler?.({ payload: { handle } }),
  };
  return b;
};

const attach = (b: ReturnType<typeof createBackend>, handle: string | null) =>
  attachVaultSettings(window, handle, {
    tauri: true,
    invoke: b.invoke as any,
    listen: b.listen as any,
  });

afterEach(() => {
  detachVaultSettings();
});

describe("parse and merge", () => {
  it("parses valid overrides", () => {
    const { overrides, problems } = parseVaultSettings({
      navigator: { sort: "modified_desc" },
      files: { new_drawing_folder: "Sketches/Inbox" },
    });
    expect(problems).toEqual([]);
    expect(overrides).toEqual({
      navigatorSort: "modified_desc",
      newDrawingFolder: "Sketches/Inbox",
    });
  });

  it("ignores invalid values with a problem", () => {
    const { overrides, problems } = parseVaultSettings({
      navigator: { sort: "random" },
      files: { new_drawing_folder: "../x" },
    });
    expect(overrides).toEqual({});
    expect(problems).toHaveLength(2);
    expect(problems[1].message).toContain(
      'settings.toml: files.new_drawing_folder = "../x" is not valid (expected',
    );
  });

  it("handles non-object input", () => {
    expect(parseVaultSettings(null)).toEqual({
      overrides: {},
      pluginOverrides: {},
      problems: [],
    });
  });

  it("per-vault beats global beats default", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      navigatorSort: "name_desc" as const,
    };
    expect(resolveSetting("navigatorSort", {}, prefs)).toBe("name_desc");
    expect(
      resolveSetting("navigatorSort", { navigatorSort: "modified_asc" }, prefs),
    ).toBe("modified_asc");
    expect(resolveSettings({ newDrawingFolder: "A" }, prefs)).toEqual({
      activityBar: true,
      activityBarOrder: [],
      activityBarHidden: [],
      navigatorSort: "name_desc",
      newDrawingFolder: "A",
      templatesFolder: "Templates",
      paperStyle: "plain",
      ...HISTORY_DEFAULTS,
      toolRectangle: {},
      toolDiamond: {},
      toolEllipse: {},
      toolArrow: {},
      toolLine: {},
      toolText: {},
      tabsOpenFromNavigator: "current",
      tabsRestore: true,
    });
    expect(resolveSettings({ templatesFolder: "T/x" }, prefs)).toMatchObject({
      templatesFolder: "T/x",
    });
    expect(resolveSettings({ paperStyle: "graph" }, prefs).paperStyle).toBe(
      "graph",
    );
  });

  it("parses a templates folder override and rejects an empty one", () => {
    expect(
      parseVaultSettings({ files: { templates_folder: "Tpl" } }).overrides,
    ).toEqual({ templatesFolder: "Tpl" });
    const { overrides, problems } = parseVaultSettings({
      files: { templates_folder: "" },
    });
    expect(overrides).toEqual({});
    expect(problems).toHaveLength(1);
  });

  it("parses a per-vault paper style and ignores an invalid one", () => {
    expect(parseVaultSettings({ paper: { style: "dots" } }).overrides).toEqual({
      paperStyle: "dots",
    });
    const bad = parseVaultSettings({ paper: { style: "wavy" } });
    expect(bad.overrides).toEqual({});
    expect(bad.problems.map((p) => p.key)).toEqual(["paper.style"]);
  });
});

describe("runtime store", () => {
  it("loads overrides for the handle", async () => {
    const b = createBackend({ h1: { navigator: { sort: "name_desc" } } });
    await attach(b, "h1");
    expect(getVaultSettingsSnapshot()).toMatchObject({
      handle: "h1",
      loaded: true,
      overrides: { navigatorSort: "name_desc" },
      problems: [],
    });
  });

  it("null handle gives the empty snapshot", async () => {
    const b = createBackend();
    await attach(b, null);
    expect(getVaultSettingsSnapshot().handle).toBeNull();
    expect(b.invoke).not.toHaveBeenCalled();
  });

  it("reloads on change for its own handle only", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    b.files.h1 = { navigator: { sort: "modified_asc" } };
    b.emit("other");
    await Promise.resolve();
    expect(b.invoke).toHaveBeenCalledTimes(1);
    b.emit("h1");
    await vi.waitFor(() =>
      expect(getVaultSettingsSnapshot().overrides.navigatorSort).toBe(
        "modified_asc",
      ),
    );
  });

  it("keeps the snapshot object when a reload changes nothing", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    const before = getVaultSettingsSnapshot();
    b.emit("h1");
    await vi.waitFor(() => expect(b.invoke).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(getVaultSettingsSnapshot()).toBe(before);
  });

  it("keeps last good overrides on a parse error", async () => {
    const b = createBackend({ h1: { navigator: { sort: "name_desc" } } });
    await attach(b, "h1");
    b.errors.h1 = { message: "bad", line: 3 };
    b.emit("h1");
    await vi.waitFor(() =>
      expect(getVaultSettingsSnapshot().problems).toHaveLength(1),
    );
    const snap = getVaultSettingsSnapshot();
    expect(snap.overrides.navigatorSort).toBe("name_desc");
    expect(snap.problems[0]).toMatchObject({ kind: "parse", line: 3 });
    delete b.errors.h1;
    b.emit("h1");
    await vi.waitFor(() =>
      expect(getVaultSettingsSnapshot().problems).toEqual([]),
    );
  });

  it("writes and removes overrides", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    const notify = vi.fn();
    subscribeVaultSettings(notify);
    const pending = setVaultOverride("navigatorSort", "modified_desc");
    expect(getVaultSettingsSnapshot().overrides.navigatorSort).toBe(
      "modified_desc",
    ); // optimistic
    expect(await pending).toBe(true);
    expect(b.files.h1.navigator.sort).toBe("modified_desc");
    expect(await setVaultOverride("navigatorSort", null)).toBe(true);
    expect(b.files.h1.navigator.sort).toBeUndefined();
    expect(getVaultSettingsSnapshot().overrides).toEqual({});
    expect(notify).toHaveBeenCalled();
  });

  it("serialises writes", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    await Promise.all([
      setVaultOverride("navigatorSort", "name_desc"),
      setVaultOverride("newDrawingFolder", "A/B"),
    ]);
    expect(getVaultSettingsSnapshot().overrides).toEqual({
      navigatorSort: "name_desc",
      newDrawingFolder: "A/B",
    });
  });

  it("reverts and records a problem when the write fails", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    b.writeError = { message: "read-only vault" };
    expect(await setVaultOverride("navigatorSort", "name_desc")).toBe(false);
    const snap = getVaultSettingsSnapshot();
    expect(snap.overrides).toEqual({});
    expect(snap.problems[0].message).toContain("read-only vault");
  });

  it("rejects an invalid value without writing", async () => {
    const b = createBackend({ h1: {} });
    await attach(b, "h1");
    expect(await setVaultOverride("newDrawingFolder", "../x")).toBe(false);
    expect(b.invoke).toHaveBeenCalledTimes(1);
    expect(getVaultSettingsSnapshot().problems).toHaveLength(1);
  });

  it("switches handles and unsubscribes the old listener", async () => {
    const b = createBackend({
      h1: { navigator: { sort: "name_desc" } },
      h2: { files: { new_drawing_folder: "X" } },
    });
    await attach(b, "h1");
    await attach(b, "h2");
    expect(b.unlisten).toHaveBeenCalledTimes(1);
    expect(getVaultSettingsSnapshot()).toMatchObject({
      handle: "h2",
      overrides: { newDrawingFolder: "X" },
    });
  });

  it("detach clears the snapshot", async () => {
    const b = createBackend({ h1: { navigator: { sort: "name_desc" } } });
    await attach(b, "h1");
    detachVaultSettings();
    expect(getVaultSettingsSnapshot().overrides).toEqual({});
    expect(b.unlisten).toHaveBeenCalled();
  });

  it("keeps overrides in memory in a plain browser", async () => {
    await attachVaultSettings(window, "h1", { tauri: false });
    expect(getVaultSettingsSnapshot()).toMatchObject({
      handle: "h1",
      loaded: true,
    });
    expect(await setVaultOverride("navigatorSort", "name_desc")).toBe(true);
    expect(getVaultSettingsSnapshot().overrides.navigatorSort).toBe(
      "name_desc",
    );
    expect(await setVaultOverride("navigatorSort", null)).toBe(true);
    expect(getVaultSettingsSnapshot().overrides).toEqual({});
  });
});

describe("subscribePreferences", () => {
  it("notifies on update and unsubscribes", () => {
    const fn = vi.fn();
    const off = subscribePreferences(fn);
    updatePreferences({ navigatorSort: "name_desc" }, window);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    updatePreferences({ navigatorSort: "name_asc" }, window);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
