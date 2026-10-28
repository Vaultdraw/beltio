import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  getPreferences,
  getTheme,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  disposeSettings,
  flushSettings,
  formatConfigError,
  getSettingsStatus,
  initSettings,
  openConfigDir,
  PREFERENCES_CHANGED_EVENT,
  preferencesToConfigChanges,
  reloadSettings,
  SETTINGS_STATUS_EVENT,
  stateToPreferences,
  type LoadSettingsResult,
} from "../vault/settingsSync";

const DEFAULT_CONFIG = {
  appearance: {
    theme: "Default",
    mode: "system",
    sync_canvas: false,
    canvas_background: "#ffffff",
  },
  editor: {
    font_family: 5,
    font_size: 20,
    stroke_color: "#1e1e1e",
    background_color: "transparent",
    fill_style: "solid",
    stroke_width: 2,
    roughness: 1,
  },
  saving: { autosave_delay_ms: 500 },
};

type Config = Record<string, Record<string, unknown>>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Minimal fake of the Rust side: a config object, a state object, events. */
const createBackend = (initial?: {
  config?: Config | null;
  configError?: LoadSettingsResult["configError"];
  state?: Record<string, unknown>;
}) => {
  const backend = {
    config: (initial?.config === undefined
      ? clone(DEFAULT_CONFIG)
      : initial.config) as Config | null,
    configError: initial?.configError ?? null,
    state: initial?.state ?? {},
    /** What the native consent dialog answers. */
    grantAnswer: true,
    handler: null as null | ((e: { payload: unknown }) => void),
    unlisten: vi.fn(),
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "load_settings":
          return {
            configDir: "/home/u/.config/vaultdraw",
            configPath: "/home/u/.config/vaultdraw/config.toml",
            statePath: "/home/u/.local/state/vaultdraw/state.json",
            config: clone(backend.config),
            configError: backend.configError,
            state: clone(backend.state),
          } as LoadSettingsResult;
        case "update_config": {
          if (!backend.config) {
            throw Object.assign(new Error("config.toml is invalid"), {
              code: "CONFIG_INVALID",
            });
          }
          for (const { key, value } of (args as any).changes) {
            const [table, name] = key.split(".");
            backend.config[table] ??= {};
            if (value === null) {
              delete backend.config[table][name];
            } else {
              backend.config[table][name] = value;
            }
          }
          return undefined;
        }
        case "network_grant": {
          if (!backend.grantAnswer) {
            return false;
          }
          backend.config ??= {};
          backend.config.network ??= {};
          for (const key of [
            (args as any).key,
            ...((args as any).also ?? []),
          ]) {
            backend.config.network[key] = true;
          }
          return true;
        }
        case "write_state":
          backend.state = clone((args as any).state);
          return undefined;
        case "open_config_dir":
          return undefined;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    }),
    listen: vi.fn(async (event: string, handler: any) => {
      expect(event).toBe("config-change");
      backend.handler = handler;
      return backend.unlisten;
    }),
    /** Simulate the file watcher. */
    emitChange: () =>
      backend.handler?.({
        payload: { paths: ["/home/u/.config/vaultdraw/config.toml"] },
      }),
    callsOf: (cmd: string) =>
      backend.invoke.mock.calls.filter(([c]) => c === cmd),
  };
  return backend;
};

const init = (backend: ReturnType<typeof createBackend>) =>
  initSettings(window, {
    tauri: true,
    invoke: backend.invoke as any,
    listen: backend.listen as any,
  });

describe("settingsSync mapping", () => {
  it("formats config errors with and without a line", () => {
    expect(formatConfigError({ message: "bad", line: 3 })).toBe(
      "config.toml line 3: bad",
    );
    expect(formatConfigError({ message: "symlink refused", line: null })).toBe(
      "config.toml: symlink refused",
    );
  });

  it("maps config.toml values to preferences", () => {
    const { values, problems } = configToPreferences({
      appearance: { theme: "Nord", mode: "dark", sync_canvas: true },
      editor: { font_family: 8, roughness: 0, fill_style: "hachure" },
      saving: { autosave_delay_ms: 1000 },
    });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      colorTheme: "Nord",
      theme: "dark",
      syncCanvas: true,
      defaultFontFamily: 8,
      defaultRoughness: 0,
      defaultFillStyle: "hachure",
      autosaveDelayMs: 1000,
      // missing keys -> defaults
      defaultFontSize: 20,
      defaultCanvasBackground: "#ffffff",
    });
  });

  it("falls back per field and reports invalid values", () => {
    const { values, problems } = configToPreferences({
      appearance: { mode: "purple", sync_canvas: "yes" },
      editor: { font_family: 4, font_size: 28 },
    });
    expect(values.theme).toBe("system");
    expect(values.syncCanvas).toBe(false);
    expect(values.defaultFontFamily).toBe(5);
    expect(values.defaultFontSize).toBe(28);
    expect(problems.map((p) => p.key)).toEqual([
      "appearance.mode",
      "appearance.sync_canvas",
      "editor.font_family",
    ]);
    expect(problems[0].message).toContain('appearance.mode = "purple"');
  });

  it("maps preference changes to dotted keys, changed keys only", () => {
    const prev = { ...DEFAULT_PREFERENCES };
    const next = {
      ...prev,
      theme: "dark" as const,
      defaultStrokeWidth: 4,
      recentVaults: ["/v"],
    };
    expect(preferencesToConfigChanges(prev, next)).toEqual([
      { key: "appearance.mode", value: "dark" },
      { key: "editor.stroke_width", value: 4 },
    ]);
    expect(preferencesToConfigChanges(prev, { ...prev })).toEqual([]);
  });

  it("maps the phase 2 keys from config.toml", () => {
    const { values, problems } = configToPreferences({
      appearance: { accent_color: "#336699" },
      interface: { zoom: 125 },
      navigator: { sort: "modified_desc" },
      files: {
        confirm_delete: false,
        new_drawing_folder: "Inbox/Deep",
        templates_folder: "Shared/Tpl",
      },
    });
    expect(
      configToPreferences({ interface: { show_tag_chips: false } }),
    ).toMatchObject({
      values: { showTagChips: false },
      problems: [],
    });
    expect(configToPreferences({}).values.showTagChips).toBe(true);
    expect(
      configToPreferences({
        interface: { show_tag_chips: "yes" },
      }).problems.map((p) => p.key),
    ).toEqual(["interface.show_tag_chips"]);
    expect(
      preferencesToConfigChanges(DEFAULT_PREFERENCES, {
        ...DEFAULT_PREFERENCES,
        showTagChips: false,
      }),
    ).toEqual([{ key: "interface.show_tag_chips", value: false }]);
    expect(configToPreferences({}).values.noticeSeconds).toBe(8);
    expect(
      configToPreferences({ interface: { notice_seconds: 0 } }),
    ).toMatchObject({ values: { noticeSeconds: 0 }, problems: [] });
    for (const bad of [-1, 121, 2.5, "8"]) {
      expect(
        configToPreferences({
          interface: { notice_seconds: bad },
        }).problems.map((p) => p.key),
      ).toEqual(["interface.notice_seconds"]);
    }
    expect(
      preferencesToConfigChanges(DEFAULT_PREFERENCES, {
        ...DEFAULT_PREFERENCES,
        noticeSeconds: 20,
      }),
    ).toEqual([{ key: "interface.notice_seconds", value: 20 }]);
    expect(configToPreferences({}).values.deferHomePane).toBe(true);
    expect(
      configToPreferences({ interface: { defer_home_pane: false } }),
    ).toMatchObject({ values: { deferHomePane: false }, problems: [] });
    expect(
      configToPreferences({
        interface: { defer_home_pane: 1 },
      }).problems.map((p) => p.key),
    ).toEqual(["interface.defer_home_pane"]);
    expect(
      preferencesToConfigChanges(DEFAULT_PREFERENCES, {
        ...DEFAULT_PREFERENCES,
        deferHomePane: false,
      }),
    ).toEqual([{ key: "interface.defer_home_pane", value: false }]);
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      accentColor: "#336699",
      zoom: 125,
      navigatorSort: "modified_desc",
      confirmDelete: false,
      newDrawingFolder: "Inbox/Deep",
      templatesFolder: "Shared/Tpl",
    });
  });

  it("maps the activity bar entry lists (default empty, non-lists reported)", () => {
    const { values } = configToPreferences({});
    expect(values.activityBarOrder).toEqual([]);
    expect(values.activityBarHidden).toEqual([]);
    expect(
      configToPreferences({
        interface: {
          activity_bar_order: ["graph"],
          activity_bar_hidden: ["tags"],
        },
      }).values,
    ).toMatchObject({
      activityBarOrder: ["graph"],
      activityBarHidden: ["tags"],
    });
    expect(
      configToPreferences({
        interface: { activity_bar_order: "graph", activity_bar_hidden: [1] },
      }).problems.map((p) => p.key),
    ).toEqual([
      "interface.activity_bar_order",
      "interface.activity_bar_hidden",
    ]);
  });

  it("maps interface.activity_bar (default on, invalid reported)", () => {
    expect(configToPreferences({}).values.activityBar).toBe(true);
    expect(
      configToPreferences({ interface: { activity_bar: false } }).values
        .activityBar,
    ).toBe(false);
    expect(
      configToPreferences({ interface: { activity_bar: 1 } }).problems.map(
        (p) => p.key,
      ),
    ).toEqual(["interface.activity_bar"]);
  });

  it("defaults the phase 2 keys when absent", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      accentColor: DEFAULT_PREFERENCES.accentColor,
      zoom: 100,
      navigatorSort: DEFAULT_PREFERENCES.navigatorSort,
      confirmDelete: true,
      newDrawingFolder: "",
      templatesFolder: "Templates",
    });
  });

  it.each([
    ["appearance", "accent_color", "blue", "accentColor"],
    ["interface", "zoom", 300, "zoom"],
    ["interface", "zoom", 49, "zoom"],
    ["interface", "zoom", 120.5, "zoom"],
    ["navigator", "sort", "random", "navigatorSort"],
    ["files", "confirm_delete", "no", "confirmDelete"],
    ["files", "new_drawing_folder", "../escape", "newDrawingFolder"],
    ["files", "new_drawing_folder", "/abs", "newDrawingFolder"],
    ["files", "templates_folder", "../escape", "templatesFolder"],
    ["files", "templates_folder", "", "templatesFolder"],
  ] as const)(
    "invalid %s.%s = %j reports a problem and uses the default",
    (table, name, bad, field) => {
      const { values, problems } = configToPreferences({
        [table]: { [name]: bad },
      });
      expect(problems.map((p) => p.key)).toEqual([`${table}.${name}`]);
      expect(values[field]).toBe(DEFAULT_PREFERENCES[field]);
    },
  );

  it("maps phase 2 preference changes to dotted keys", () => {
    const prev = { ...DEFAULT_PREFERENCES };
    const next = {
      ...prev,
      accentColor: "#336699",
      zoom: 150,
      navigatorSort: "name_desc" as const,
      confirmDelete: false,
      newDrawingFolder: "Inbox",
    };
    expect(preferencesToConfigChanges(prev, next)).toEqual(
      expect.arrayContaining([
        { key: "appearance.accent_color", value: "#336699" },
        { key: "interface.zoom", value: 150 },
        { key: "navigator.sort", value: "name_desc" },
        { key: "files.confirm_delete", value: false },
        { key: "files.new_drawing_folder", value: "Inbox" },
      ]),
    );
    expect(preferencesToConfigChanges(prev, next)).toHaveLength(5);
    // and back: values written then read give the same preferences
    const written = Object.fromEntries(
      preferencesToConfigChanges(prev, next).map((c) => [c.key, c.value]),
    );
    const { values } = configToPreferences({
      appearance: { accent_color: written["appearance.accent_color"] },
      interface: { zoom: written["interface.zoom"] },
      navigator: { sort: written["navigator.sort"] },
      files: {
        confirm_delete: written["files.confirm_delete"],
        new_drawing_folder: written["files.new_drawing_folder"],
      },
    });
    expect(values).toMatchObject({
      accentColor: "#336699",
      zoom: 150,
      navigatorSort: "name_desc",
      confirmDelete: false,
      newDrawingFolder: "Inbox",
    });
  });

  it("maps the paper keys from config.toml and back", () => {
    const paper = {
      style: "graph",
      spacing: 12,
      color: "#336699",
      opacity: 0.5,
      major_every: 4,
      margin_line: false,
    };
    const { values, problems } = configToPreferences({ paper });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      paperStyle: "graph",
      paperSpacing: 12,
      paperColor: "#336699",
      paperOpacity: 0.5,
      paperMajorEvery: 4,
      paperMarginLine: false,
    });
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      ...values,
    });
    expect(Object.fromEntries(changes.map((c) => [c.key, c.value]))).toEqual(
      Object.fromEntries(
        Object.entries(paper).map(([k, v]) => [`paper.${k}`, v]),
      ),
    );
  });

  it("maps the page keys from config.toml and back", () => {
    const page = {
      mode: "page",
      layout: "continuous",
      size: "custom",
      orientation: "landscape",
      width: 900,
      height: 1200,
      paper_theme: "old_school",
    };
    const { values, problems } = configToPreferences({ page });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      pageMode: "page",
      pageLayout: "continuous",
      pageSize: "custom",
      pageOrientation: "landscape",
      pageWidth: 900,
      pageHeight: 1200,
      pagePaperTheme: "old_school",
    });
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      ...values,
    });
    expect(Object.fromEntries(changes.map((c) => [c.key, c.value]))).toEqual(
      Object.fromEntries(
        Object.entries(page).map(([k, v]) => [`page.${k}`, v]),
      ),
    );
  });

  it("defaults the page keys when absent", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      pageMode: "normal",
      pageLayout: "separate",
      pageSize: "a4",
      pageOrientation: "portrait",
      pageWidth: 0,
      pageHeight: 0,
      pagePaperTheme: "normal",
    });
  });

  it.each([
    ["mode", "pages", "pageMode"],
    ["layout", "stack", "pageLayout"],
    ["size", "a9", "pageSize"],
    ["orientation", "sideways", "pageOrientation"],
    ["width", 50, "pageWidth"],
    ["width", 5001, "pageWidth"],
    ["height", 120.5, "pageHeight"],
    ["paper_theme", "oldSchool", "pagePaperTheme"],
  ] as const)(
    "invalid page.%s = %j reports a problem and uses the default",
    (name, bad, field) => {
      const { values, problems } = configToPreferences({
        page: { [name]: bad },
      });
      expect(problems.map((p) => p.key)).toEqual([`page.${name}`]);
      expect(problems[0].message).toContain("expected");
      expect(values[field]).toBe(DEFAULT_PREFERENCES[field]);
    },
  );

  it("defaults the paper keys when absent", () => {
    const { values, problems } = configToPreferences({});
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      paperStyle: "plain",
      paperSpacing: 0,
      paperColor: "",
      paperOpacity: 1,
      paperMajorEvery: 0,
      paperMarginLine: true,
    });
  });

  it.each([
    ["style", "wavy", "paperStyle"],
    ["spacing", 4, "paperSpacing"],
    ["spacing", 201, "paperSpacing"],
    ["color", "blue", "paperColor"],
    ["color", "#fff", "paperColor"],
    ["opacity", 0.05, "paperOpacity"],
    ["opacity", 2, "paperOpacity"],
    ["major_every", 21, "paperMajorEvery"],
    ["major_every", 2.5, "paperMajorEvery"],
    ["margin_line", "yes", "paperMarginLine"],
  ] as const)(
    "invalid paper.%s = %j reports a problem and uses the default",
    (name, bad, field) => {
      const { values, problems } = configToPreferences({
        paper: { [name]: bad },
      });
      expect(problems.map((p) => p.key)).toEqual([`paper.${name}`]);
      expect(values[field]).toBe(DEFAULT_PREFERENCES[field]);
    },
  );

  it("validates state.json fields", () => {
    expect(
      stateToPreferences({
        recentVaults: ["/a", 3],
        lastVaultPath: "/a",
        navigatorCollapsed: "no",
        navigatorWidth: 300,
        expandedFolders: { "/a": ["", "x"] },
      }),
    ).toEqual({
      recentVaults: [],
      lastVaultPath: "/a",
      navigatorCollapsed: false,
      navigatorWidth: 300,
      expandedFolders: { "/a": ["", "x"] },
      hasPanned: false,
      profileChoice: null,
      exportOptions: {
        scale: expect.any(Number),
        background: true,
        embedScene: false,
        pattern: true,
        pageShaped: false,
      },
    });
  });
});

describe("settingsSync runtime", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    disposeSettings();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("keeps localStorage behaviour in a plain browser", async () => {
    const status = await initSettings(window);
    expect(status.mode).toBe("browser");
    updatePreferences({ theme: "dark" }, window);
    expect(
      window.localStorage.getItem("excalidraw-vault-preferences-v1"),
    ).toContain('"theme":"dark"');
    expect(getTheme(window)).toBe("dark");
  });

  it("hydrates preferences from load_settings", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        appearance: {
          ...DEFAULT_CONFIG.appearance,
          mode: "dark",
          theme: "Nord",
        },
      },
      state: {
        recentVaults: ["/v1"],
        lastVaultPath: "/v1",
        navigatorWidth: 320,
      },
    });
    const status = await init(backend);
    expect(status.mode).toBe("tauri");
    expect(status.configPath).toBe("/home/u/.config/vaultdraw/config.toml");
    expect(status.problems).toEqual([]);
    const prefs = getPreferences(window);
    expect(prefs.theme).toBe("dark");
    expect(prefs.colorTheme).toBe("Nord");
    expect(prefs.recentVaults).toEqual(["/v1"]);
    expect(prefs.navigatorWidth).toBe(320);
    expect(backend.listen).toHaveBeenCalledTimes(1);
    // nothing written on startup
    expect(backend.callsOf("update_config")).toHaveLength(0);
    expect(backend.callsOf("write_state")).toHaveLength(0);
  });

  it("sends a single update_config with only the changed keys", async () => {
    const backend = createBackend();
    await init(backend);
    const returned = updatePreferences(
      { theme: "dark", defaultFontSize: 20, defaultFontFamily: 6 },
      window,
    );
    // memory first, synchronously
    expect(returned.theme).toBe("dark");
    expect(getTheme(window)).toBe("dark");
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.callsOf("update_config")).toEqual([
      [
        "update_config",
        {
          changes: [
            { key: "appearance.mode", value: "dark" },
            { key: "editor.font_family", value: 6 },
          ],
        },
      ],
    ]);
    // no-op update writes nothing
    updatePreferences({ theme: "dark" }, window);
    await Promise.resolve();
    expect(backend.callsOf("update_config")).toHaveLength(1);
  });

  it("sends consent grants to network_grant, never update_config", async () => {
    const backend = createBackend();
    await init(backend);
    updatePreferences(
      { networkAllowThemes: true, networkEnabled: false, theme: "dark" },
      window,
    );
    await flushSettings();
    // turning it off is an ordinary write; the grant is not part of it
    expect(backend.callsOf("update_config")).toEqual([
      [
        "update_config",
        {
          changes: [
            { key: "network.enabled", value: false },
            { key: "appearance.mode", value: "dark" },
          ],
        },
      ],
    ]);
    expect(backend.callsOf("network_grant")).toEqual([
      ["network_grant", { key: "allow_themes" }],
    ]);
    expect(getPreferences(window).networkAllowThemes).toBe(true);
    updatePreferences({ networkEnabled: true }, window);
    await flushSettings();
    expect(backend.callsOf("network_grant").map(([, a]) => a)).toEqual([
      { key: "allow_themes" },
      { key: "enabled" },
    ]);
    expect(backend.callsOf("update_config")).toHaveLength(1);
  });

  it("asks once when the master switch and a purpose are granted together", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        network: { enabled: false, allow_themes: false },
      },
    });
    await init(backend);
    updatePreferences(
      { networkEnabled: true, networkAllowThemes: true },
      window,
    );
    await flushSettings();
    expect(backend.callsOf("network_grant")).toEqual([
      ["network_grant", { key: "enabled", also: ["allow_themes"] }],
    ]);
    expect(backend.config?.network).toEqual({
      enabled: true,
      allow_themes: true,
    });
    expect(getPreferences(window).networkEnabled).toBe(true);
    expect(getPreferences(window).networkAllowThemes).toBe(true);
  });

  it("puts both switches back when the one dialog says no", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        network: { enabled: false, allow_themes: false },
      },
    });
    backend.grantAnswer = false;
    await init(backend);
    updatePreferences(
      { networkEnabled: true, networkAllowThemes: true },
      window,
    );
    await flushSettings();
    expect(backend.callsOf("network_grant")).toHaveLength(1);
    expect(getPreferences(window).networkEnabled).toBe(false);
    expect(getPreferences(window).networkAllowThemes).toBe(false);
  });

  it("puts a consent switch back when the native dialog says no", async () => {
    const backend = createBackend();
    backend.grantAnswer = false;
    await init(backend);
    updatePreferences({ networkAllowThemes: true }, window);
    expect(getPreferences(window).networkAllowThemes).toBe(true);
    await flushSettings();
    expect(getPreferences(window).networkAllowThemes).toBeUndefined();
    expect(backend.config?.network?.allow_themes).toBeUndefined();
    expect(backend.callsOf("update_config")).toHaveLength(0);
  });

  it("revokes consent with a normal update_config write", async () => {
    const backend = createBackend({
      config: { ...clone(DEFAULT_CONFIG), network: { allow_themes: true } },
    });
    await init(backend);
    updatePreferences({ networkAllowThemes: false }, window);
    await flushSettings();
    expect(backend.callsOf("network_grant")).toHaveLength(0);
    expect(backend.config?.network?.allow_themes).toBe(false);
  });

  it("debounces write_state and skips unchanged state", async () => {
    const backend = createBackend({ state: { recentVaults: [] } });
    await init(backend);
    vi.useFakeTimers();
    updatePreferences({ navigatorCollapsed: true }, window);
    updatePreferences({ navigatorWidth: 300 }, window);
    updatePreferences({ recentVaults: ["/v"] }, window);
    expect(backend.callsOf("write_state")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(299);
    expect(backend.callsOf("write_state")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.callsOf("write_state")).toHaveLength(1);
    expect(backend.state).toEqual({
      recentVaults: ["/v"],
      lastVaultPath: null,
      navigatorCollapsed: true,
      navigatorWidth: 300,
      expandedFolders: {},
      hasPanned: false,
      profileChoice: null,
      exportOptions: {
        scale: expect.any(Number),
        background: true,
        embedScene: false,
        pattern: true,
        pageShaped: false,
      },
    });
    // state fields never go to update_config
    expect(backend.callsOf("update_config")).toHaveLength(0);

    // changing and changing back within the window writes nothing
    updatePreferences({ navigatorCollapsed: false }, window);
    updatePreferences({ navigatorCollapsed: true }, window);
    await vi.advanceTimersByTimeAsync(400);
    expect(backend.callsOf("write_state")).toHaveLength(1);
  });

  it("reports invalid file values and uses the field default", async () => {
    const backend = createBackend({
      config: {
        ...clone(DEFAULT_CONFIG),
        appearance: { ...DEFAULT_CONFIG.appearance, mode: "sepia" },
        saving: { autosave_delay_ms: "fast" },
      },
    });
    const status = await init(backend);
    expect(getTheme(window)).toBe("system");
    expect(getPreferences(window).autosaveDelayMs).toBe(500);
    expect(status.problems.map((p) => p.key)).toEqual([
      "appearance.mode",
      "saving.autosave_delay_ms",
    ]);
  });

  it("ignores config-change batches that only touch plugins, themes, snippets or .git", async () => {
    const backend = createBackend();
    await init(backend);
    const loads = () => backend.callsOf("load_settings").length;
    const before = loads();
    const root = "/home/u/.config/vaultdraw";
    backend.handler?.({
      payload: { paths: [`${root}/plugins/a/main.js`, `${root}/.git/index`] },
    });
    backend.handler?.({ payload: { paths: [`${root}/themes/x.toml`] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(loads()).toBe(before);
    backend.handler?.({
      payload: { paths: [`${root}/plugins/a/main.js`, `${root}/config.toml`] },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(loads()).toBeGreaterThan(before);
  });

  it("reloads on config-change and dispatches only when something changed", async () => {
    const backend = createBackend();
    await init(backend);
    const onChange = vi.fn();
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    try {
      // our own write echoes back: no event
      updatePreferences({ defaultStrokeWidth: 4 }, window);
      backend.emitChange();
      await reloadSettings();
      expect(onChange).not.toHaveBeenCalled();
      expect(getPreferences(window).defaultStrokeWidth).toBe(4);

      // hand edit: event with the new preferences
      backend.config!.appearance.mode = "light";
      backend.config!.editor.roughness = 2;
      backend.emitChange();
      await reloadSettings();
      expect(onChange).toHaveBeenCalledTimes(1);
      const detail = (onChange.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.theme).toBe("light");
      expect(detail.defaultRoughness).toBe(2);
      expect(getTheme(window)).toBe("light");

      // unchanged file: no further event
      backend.emitChange();
      await reloadSettings();
      expect(onChange).toHaveBeenCalledTimes(1);

      // deleting a line returns that field to its default
      delete backend.config!.editor.roughness;
      await reloadSettings();
      expect(getPreferences(window).defaultRoughness).toBe(1);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    }
  });

  it("keeps last good values on a parse error and reports the line", async () => {
    const backend = createBackend();
    backend.config!.appearance.mode = "dark";
    await init(backend);
    const onStatus = vi.fn();
    const onChange = vi.fn();
    window.addEventListener(SETTINGS_STATUS_EVENT, onStatus);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    try {
      backend.config = null;
      backend.configError = { message: "expected `=`", line: 7 };
      await reloadSettings();
      expect(getTheme(window)).toBe("dark");
      expect(onChange).not.toHaveBeenCalled();
      const status = getSettingsStatus();
      expect(status.problems[0]).toMatchObject({
        kind: "parse",
        message: "config.toml line 7: expected `=`",
      });
      expect(onStatus).toHaveBeenCalledTimes(1);

      // same error again: status unchanged, no duplicate event
      await reloadSettings();
      expect(onStatus).toHaveBeenCalledTimes(1);

      // GUI write while broken: memory updates, failure is reported
      updatePreferences({ defaultFontSize: 28 }, window);
      await reloadSettings();
      expect(getPreferences(window).defaultFontSize).toBe(28);
      expect(getSettingsStatus().problems.map((p) => p.kind)).toContain("io");

      // fixed file: problem cleared, values from the file
      backend.config = clone(DEFAULT_CONFIG);
      backend.configError = null;
      updatePreferences({ defaultFontSize: 36 }, window);
      await reloadSettings();
      expect(getSettingsStatus().problems).toEqual([]);
      expect(getPreferences(window).defaultFontSize).toBe(36);
      expect(getTheme(window)).toBe("system");
    } finally {
      window.removeEventListener(SETTINGS_STATUS_EVENT, onStatus);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onChange);
    }
  });

  it("migrates machine state from localStorage when state.json is empty", async () => {
    window.localStorage.setItem(
      "excalidraw-vault-preferences-v1",
      JSON.stringify({
        recentVaults: ["/old"],
        lastVaultPath: "/old",
        theme: "dark",
      }),
    );
    const backend = createBackend({ state: {} });
    vi.useFakeTimers();
    await init(backend);
    expect(getPreferences(window).recentVaults).toEqual(["/old"]);
    // config comes from config.toml, not localStorage
    expect(getTheme(window)).toBe("system");
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.state.recentVaults).toEqual(["/old"]);
  });

  it("falls back to localStorage when load_settings fails", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("no such command");
    });
    const status = await initSettings(window, {
      tauri: true,
      invoke: invoke as any,
      listen: vi.fn() as any,
    });
    expect(status.mode).toBe("browser");
    expect(status.problems[0].message).toContain("no such command");
    updatePreferences({ theme: "light" }, window);
    expect(
      window.localStorage.getItem("excalidraw-vault-preferences-v1"),
    ).toContain('"theme":"light"');
  });

  it("opens the config folder and unlistens on dispose", async () => {
    const backend = createBackend();
    await init(backend);
    await openConfigDir();
    expect(backend.callsOf("open_config_dir")).toHaveLength(1);
    disposeSettings();
    expect(backend.unlisten).toHaveBeenCalled();
    await expect(openConfigDir()).rejects.toThrow();
  });

  describe("interface.thumbnail_max_elements", () => {
    it("defaults to 8000 and accepts integers from 100 to 50000", () => {
      expect(DEFAULT_PREFERENCES.thumbnailMaxElements).toBe(8000);
      expect(
        configToPreferences({ interface: { thumbnail_max_elements: 20000 } }),
      ).toMatchObject({
        values: { thumbnailMaxElements: 20000 },
        problems: [],
      });
      for (const bad of [99, 50001, 1.5, "big", true]) {
        expect(
          configToPreferences({
            interface: { thumbnail_max_elements: bad },
          }).problems.map((p) => p.key),
        ).toEqual(["interface.thumbnail_max_elements"]);
      }
      expect(
        preferencesToConfigChanges(DEFAULT_PREFERENCES, {
          ...DEFAULT_PREFERENCES,
          thumbnailMaxElements: 3000,
        }),
      ).toEqual([{ key: "interface.thumbnail_max_elements", value: 3000 }]);
    });
  });
});
