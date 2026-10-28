// Vendored: `vaultdraw-plugin` copies this folder (index, types, rules, host, scene, panels) into TypeScript plugin projects as testing/; it is `@vaultdraw/api/testing` in this repo.
/**
 * Test a plugin without the app: `boot(manifest, plugin)` runs it against a
 * small in-memory host that follows the app's rules (declared commands and
 * panels only, lazy activation, toast prefix, setting bounds, disposal).
 * Panels need the optional packages `react`, `react-dom` and
 * `@testing-library/react`. Anything the mock does not provide fails with
 * "not set up in this test: ...".
 */
import { createMockHost } from "./host";
import { loadPanelDeps } from "./panels";

import type { Plugin } from "@vaultdraw/api";
import type {
  BootOptions,
  TestManifest,
  TestPlugin,
  TestPluginInfo,
} from "./types";

export type { FakeClipboard } from "./clipboard";
export type {
  BootOptions,
  FakeBatch,
  FakeElement,
  FakeElementInput,
  FakeEvents,
  FakeFolders,
  FakePdf,
  FakeScene,
  FakeStorage,
  FakeTheme,
  FakeVault,
  FakeWorkspace,
  PanelView,
  PluginLogLine,
  StatusBarShown,
  TestManifest,
  TestPlugin,
  TestPluginInfo,
  ToolDriver,
} from "./types";

/** One animation frame is 16 ms; the scene notifies once per frame. */
const FRAME_MS = 20;

const normalise = (m: TestManifest) => {
  const c = m.contributes ?? {};
  const info: TestPluginInfo & {
    dir: string;
    dev?: boolean;
    activation: string[];
  } = {
    id: m.id,
    name: m.name ?? m.id,
    version: m.version ?? "0.1.0",
    permissions: m.permissions ?? [],
    dataKey: m.dataKey ?? null,
    dir: m.dir ?? `/plugins/${m.id}`,
    dev: m.dev,
    activation: m.activation ?? [],
    contributes: {
      commands: (c.commands ?? []).map((x) => ({
        title: x.id,
        keys: [],
        when: [],
        palette: true,
        ...x,
      })),
      panels: (c.panels ?? []).map((x) => ({
        title: x.id,
        icon: null,
        group: "top" as const,
        ...x,
      })),
      settings: c.settings ?? [],
      importers: (c.importers ?? []).map((x) => ({
        title: x.id,
        ...x,
      })),
      menus: (c.menus ?? []).map((x) => ({
        title: null,
        kinds: [],
        ...x,
      })),
      shapes: (c.shapes ?? []).map((x) => ({
        title: x.id,
        icon: null,
        width: 160,
        height: 100,
        ...x,
      })),
      methods: (c.methods ?? []).map((x) => ({
        title: x.id,
        mcp: false,
        write: false,
        ...x,
      })),
      tools: (c.tools ?? []).map((x) => ({
        title: x.id,
        icon: null,
        cursor: null,
        ...x,
      })),
      toolbar: (c.toolbar ?? []).map((x) => ({
        title: null,
        icon: null,
        priority: 0,
        ...x,
      })),
      views: (c.views ?? []).map((x) => ({ title: x.id, ...x })),
      status_bar: (c.status_bar ?? []).map((x) => ({
        title: x.id,
        align: "right" as const,
        priority: 0,
        command: null,
        ...x,
      })),
    },
  };
  return info;
};

/** Boots `plugin` with `manifest` in a mock host (activation stays lazy unless the manifest says otherwise). `options` are the app settings of the test. */
export async function boot(
  manifest: TestManifest,
  plugin: Plugin,
  options: BootOptions = {},
): Promise<TestPlugin> {
  const info = normalise(manifest);
  const deps =
    info.contributes.panels.length > 0 ||
    (info.contributes.views ?? []).length > 0
      ? await loadPanelDeps()
      : null;
  const host = createMockHost(info, plugin, deps, options);
  await host.startup();

  /** Timers, microtasks and one frame; fake timers (sinon based) are advanced. */
  const flush = () =>
    host.act(async () => {
      const faked = (
        globalThis.setTimeout as unknown as {
          clock?: { tickAsync(ms: number): Promise<unknown> };
        }
      ).clock;
      if (faked) {
        await faked.tickAsync(FRAME_MS);
      } else {
        await new Promise((r) => setTimeout(r, FRAME_MS));
      }
      await Promise.resolve();
    });
  const disable = async () => {
    await host.stop();
    await flush();
  };
  return {
    info,
    run: host.run,
    callMethod: host.callMethod,
    openPanel: host.openPanel,
    tool: host.tool,
    insertShape: host.insertShape,
    menuItems: host.menuItems,
    chooseMenuItem: host.chooseMenuItem,
    notes: host.notes,
    openView: host.openView,
    openedFromViews: host.openedFromViews,
    openPanelIds: host.openPanelIds,
    renderMath: host.renderMath,
    overlay: host.overlay,
    present: host.present,
    statusBar: host.statusBar,
    async clickStatusBar(id) {
      const item = host.statusBar().find((x) => x.id === id);
      if (!item) {
        throw new Error(`status bar item "${id}" is not shown`);
      }
      if (item.command) {
        await host.run(item.command);
      }
    },
    toasts: host.toasts,
    timers: host.timers,
    log: host.log,
    setSetting: (key, value, scope = "global") =>
      host.setSetting(key, value, scope),
    scene: host.scene,
    events: { emit: host.emit },
    theme: host.theme,
    storage: host.storage,
    vault: host.vault,
    workspace: host.workspace,
    folders: host.folders,
    pdf: host.pdf,
    clipboard: host.clipboard,
    import: host.importFile,
    cancelImport: host.cancelImport,
    flush,
    disable,
    async dispose() {
      await disable();
      host.reset();
    },
  };
}
