/**
 * Plugin boot: with no plugin enabled nothing plugin-related loads. The host
 * chunk is imported on idle once the enabled list names a plugin that is not
 * an official one. Official plugins (officialPlugins.ts) are on by default but
 * cost nothing at startup: their commands and file types are stubs here, and
 * the first use (or any other start of the host) loads the real plugin.
 */
import { registerActivityEntries } from "../activityBar/activityBarRegistry";
import { IconGallery, IconGraph } from "../components/Icons";
import { getAppCommandRunner } from "../commands/appRunner";
import { registerCommandHandlers } from "../commands/handlerRegistry";

import { getRegisteredCommand, registerCommands } from "../commands/registry";
import { scheduleIdle } from "../platform/idle";
import { toastStore } from "../toasts/toastStore";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { pluginHostStarted } from "./hostFlag";
import { addMenuItems } from "./menuRegistry";
import { getOverlay, subscribeOverlay } from "./overlayStore";
import { claimImporter, setImportHostStarter } from "./importerMap";
import {
  isOfficialPluginId,
  OFFICIAL_PLUGINS,
  type OfficialPlugin,
} from "./officialPlugins";

import type { WhenClause } from "../commands/types";

const onIdle = (win: Window, run: () => void) =>
  scheduleIdle(win, run, { fallbackMs: 200 });

let starting: Promise<void> | null = null;

/**
 * Starts the host if it isn't running (one start at a time, no-op once it
 * has started). Used by boot and by plugin management (Settings > Plugins,
 * rescan, install) so the list exists even with no plugin enabled.
 */
export function ensurePluginHost(win: Window): Promise<void> {
  if (pluginHostStarted.get()) {
    return Promise.resolve();
  }
  // The host registers the real stubs under the same ids: drop the core ones first.
  releaseOfficialStubs();
  starting ??= import("./host/start")
    .then(({ startPluginHost }) => startPluginHost(win))
    .then(
      () => undefined,
      (error: unknown) => console.error("Plugin host failed to start", error),
    )
    .finally(() => {
      starting = null;
    });
  return starting;
}

const start = (win: Window) => void ensurePluginHost(win);

let releaseStubs: (() => void) | null = null;

function releaseOfficialStubs(): void {
  releaseStubs?.();
  releaseStubs = null;
}

/** Runs an official plugin's command: start the host (which registers the real command), then run it. */
async function runOfficialCommand(win: Window, fullId: string): Promise<void> {
  await ensurePluginHost(win);
  const real = getRegisteredCommand(fullId);
  if (!real || !getAppCommandRunner()?.(fullId)) {
    toastStore.push({
      message: `${
        real?.title ?? fullId
      } is not available: the plugin did not load (Settings, Plugins)`,
      kind: "error",
    });
  }
}

/** Commands and file types of one official plugin as stubs: no plugin code runs. */
function registerOfficialStubs(win: Window, plugin: OfficialPlugin) {
  const handlers: Record<string, () => Promise<void>> = {};
  const defs = plugin.commands.map((c) => {
    const id = `${plugin.id}.${c.id}`;
    handlers[id] = () => runOfficialCommand(win, id);
    return {
      id,
      title: c.title,
      category: plugin.name,
      keys: { default: c.keys ?? [] },
      ...(c.when ? { when: c.when as WhenClause[] } : {}),
      ...(c.repeat ? { repeat: true } : {}),
    };
  });
  const offs = [registerCommands(defs), registerCommandHandlers(handlers)];
  if (plugin.menus) {
    offs.push(
      addMenuItems(
        plugin.menus.map((m) => ({
          pluginId: plugin.id,
          pluginName: plugin.name,
          surface: m.surface,
          title: m.title,
          command: `${plugin.id}.${m.command}`,
          kinds: m.kinds,
        })),
      ),
    );
  }
  for (const imp of plugin.importers) {
    offs.push(
      claimImporter(
        { pluginId: plugin.id, importerId: imp.id, title: imp.title },
        imp.extensions,
      ),
    );
  }
  return () => offs.reverse().forEach((off) => off());
}

/** Registers the stubs of the official plugins the enabled list names (none once the host runs). */
function syncOfficialStubs(win: Window): void {
  releaseOfficialStubs();
  if (pluginHostStarted.get()) {
    return;
  }
  const on = OFFICIAL_PLUGINS.filter((p) =>
    getPreferences(win).pluginsEnabled.includes(p.id),
  );
  const offs = on.map((p) => registerOfficialStubs(win, p));
  releaseStubs = () => offs.forEach((off) => off());
}

const ACTIVITY_ICONS = { gallery: IconGallery, graph: IconGraph };

let releaseActivity: (() => void) | null = null;

/** The activity bar buttons of the enabled official plugins; they stay once the host runs. */
function syncOfficialActivity(win: Window): void {
  releaseActivity?.();
  const on = OFFICIAL_PLUGINS.filter(
    (p) => p.activity && getPreferences(win).pluginsEnabled.includes(p.id),
  );
  releaseActivity = on.length
    ? registerActivityEntries(
        on.map((p) => ({
          id: p.activity!.id,
          label: p.activity!.label,
          icon: ACTIVITY_ICONS[p.activity!.icon],
          commandId: `${p.id}.${p.activity!.command}`,
          group: "top" as const,
          active: {
            subscribe: subscribeOverlay,
            get: () => getOverlay()?.pluginId === p.id,
          },
        })),
      )
    : null;
}

let stopListSync: (() => void) | null = null;

export function bootPlugins(win: Window): void {
  setImportHostStarter(() => ensurePluginHost(win));
  syncOfficialStubs(win);
  syncOfficialActivity(win);
  // Enabling or disabling an official plugin (Settings, or an old saved list) updates its stubs.
  let listed = JSON.stringify(getPreferences(win).pluginsEnabled);
  stopListSync?.();
  stopListSync = subscribePreferences(() => {
    const now = JSON.stringify(getPreferences(win).pluginsEnabled);
    if (now !== listed) {
      listed = now;
      syncOfficialStubs(win);
      syncOfficialActivity(win);
    }
  });
  // Official plugins alone don't start the host: only their first use does.
  const enabled = () =>
    getPreferences(win).pluginsEnabled.some((id) => !isOfficialPluginId(id));
  if (enabled()) {
    onIdle(win, () => start(win));
    return;
  }
  const off = subscribePreferences(() => {
    if (enabled()) {
      off();
      onIdle(win, () => start(win));
    }
  });
}
