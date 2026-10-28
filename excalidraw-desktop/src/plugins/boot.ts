/**
 * Plugin boot: with no plugin enabled nothing plugin-related loads. The host
 * chunk is imported on idle once the enabled list names a plugin that is not
 * an official one. Official plugins (officialPlugins.ts) are on by default but
 * cost nothing at startup: their commands and file types are stubs here, and
 * the first use (or any other start of the host) loads the real plugin.
 */
import { registerActivityEntries } from "../activityBar/activityBarRegistry";
import { IconBookmark, IconGallery, IconGraph } from "../components/Icons";
import { getAppCommandRunner } from "../commands/appRunner";
import { registerCommandHandlers } from "../commands/handlerRegistry";

import { getRegisteredCommand, registerCommands } from "../commands/registry";
import { scheduleIdle } from "../platform/idle";
import { openPanel, panelFlag, togglePanel } from "../slots/panelStore";
import { toastStore } from "../toasts/toastStore";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { enabledPluginIds } from "./enabledIds";
import { setFormulaEditRunner } from "./formulaEdit";
import { setMathStarter } from "./mathService";

import { addPluginPanels, getPluginPanels } from "./panelRegistry";
import { pluginHostStarted } from "./hostFlag";
import { addMenuItems } from "./menuRegistry";
import { getOverlay, subscribeOverlay } from "./overlayStore";
import { claimImporter, setImportHostStarter } from "./importerMap";
import {
  isOfficialPluginId,
  OFFICIAL_PLUGINS,
  type OfficialPanel,
  type OfficialPlugin,
} from "./officialPlugins";

import type { CommandDefinition, WhenClause } from "../commands/types";

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

/** The command definitions of an official plugin's stubs (its plugin.toml, as the table lists it). */
export const officialCommandDefs = (
  plugin: OfficialPlugin,
): CommandDefinition[] =>
  plugin.commands.map((c) => ({
    id: `${plugin.id}.${c.id}`,
    title: c.title,
    category: plugin.name,
    keys: { default: c.keys ?? ([] as string[]) },
    ...(c.when ? { when: c.when as WhenClause[] } : {}),
    ...(c.repeat ? { repeat: true } : {}),
  }));

const PANEL_ICONS = { bookmark: IconBookmark } as const;

/**
 * A panel of an official plugin before the host runs: its toggle command, activity bar button and
 * a stub that starts the host when first shown. The host then registers the real ones under the same
 * ids (these are released first, which closes the panel, so it is opened again).
 */
function registerOfficialPanel(
  win: Window,
  plugin: OfficialPlugin,
  panel: OfficialPanel,
) {
  const panelId = `${plugin.id}.${panel.id}`;
  const commandId = `${plugin.id}.panel.${panel.id}`;
  const defs: CommandDefinition[] = [
    {
      id: commandId,
      title: `Toggle ${panel.title} panel`,
      category: plugin.name,
      keys: { default: [] as string[] },
    },
  ];
  return [
    registerCommands(defs),
    registerCommandHandlers({ [commandId]: () => togglePanel(panelId) }),
    registerActivityEntries([
      {
        id: panelId,
        label: panel.title,
        icon:
          PANEL_ICONS[panel.icon as keyof typeof PANEL_ICONS] ?? IconGallery,
        commandId,
        group: "top" as const,
        active: panelFlag(panelId),
      },
    ]),
    addPluginPanels([
      {
        id: panelId,
        pluginId: plugin.id,
        title: panel.title,
        load: async () => {
          await ensurePluginHost(win);
          openPanel(panelId);
          const real = getPluginPanels().find((x) => x.id === panelId);
          if (!real) {
            throw new Error(`panel ${panelId} did not load`);
          }
          return real.load();
        },
      },
    ]),
  ];
}

/** Commands and file types of one official plugin as stubs: no plugin code runs. */
function registerOfficialStubs(win: Window, plugin: OfficialPlugin) {
  const handlers: Record<string, () => Promise<void>> = {};
  const defs = officialCommandDefs(plugin);
  for (const d of defs) {
    handlers[d.id] = () => runOfficialCommand(win, d.id);
  }
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
          kinds: m.kinds ?? [],
        })),
      ),
    );
  }
  for (const p of plugin.panels ?? []) {
    offs.push(...registerOfficialPanel(win, plugin, p));
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
  const enabled = enabledPluginIds(win);
  const on = OFFICIAL_PLUGINS.filter((p) => enabled.includes(p.id));
  const offs = on.map((p) => registerOfficialStubs(win, p));
  releaseStubs = () => offs.forEach((off) => off());
}

const ACTIVITY_ICONS = { gallery: IconGallery, graph: IconGraph };

let releaseActivity: (() => void) | null = null;

/** The activity bar buttons of the enabled official plugins; they stay once the host runs. */
export function syncOfficialActivity(win: Window): void {
  releaseActivity?.();
  const on = OFFICIAL_PLUGINS.filter(
    (p) => p.activity && enabledPluginIds(win).includes(p.id),
  );
  releaseActivity = on.length
    ? registerActivityEntries(
        on.map((p) => ({
          id: p.activity!.id,
          label: p.activity!.label,
          icon: ACTIVITY_ICONS[p.activity!.icon],
          commandId: `${p.id}.${p.activity!.command}`,
          group: "top" as const,
          ...(p.activity!.after ? { after: p.activity!.after } : {}),
          active: {
            subscribe: subscribeOverlay,
            get: () => getOverlay()?.pluginId === p.id,
          },
        })),
      )
    : null;
}

let stopListSync: (() => void) | null = null;

/** Starts the formula plugin (when on) so it provides `ctx.math` to the notes view. */
async function startFormulaPlugin(win: Window): Promise<void> {
  if (!enabledPluginIds(win).includes("formula")) {
    return;
  }
  await ensurePluginHost(win);
  getAppCommandRunner()?.("formula.provide");
}

/** True when the official plugin `id` is on and its `startWhen` setting is true in config.toml. */
function wantsStart(id: string, win: Window): boolean {
  const key = OFFICIAL_PLUGINS.find((p) => p.id === id)?.startWhen;
  return !!key && getPreferences(win).pluginSettings[id]?.[key] === true;
}

export function bootPlugins(win: Window): void {
  setImportHostStarter(() => ensurePluginHost(win));
  setMathStarter(() => startFormulaPlugin(win));
  setFormulaEditRunner((id) => runOfficialCommand(win, id));
  syncOfficialStubs(win);
  syncOfficialActivity(win);
  // Enabling or disabling an official plugin (Settings, or an old saved list) updates its stubs.
  let listed = JSON.stringify(enabledPluginIds(win));
  stopListSync?.();
  stopListSync = subscribePreferences(() => {
    const now = JSON.stringify(enabledPluginIds(win));
    if (now !== listed) {
      listed = now;
      syncOfficialStubs(win);
      syncOfficialActivity(win);
    }
  });
  // Official plugins alone don't start the host: only their first use does, or a switch of theirs
  // that asks for it (`startWhen`, such as `[plugin.auto-export] enabled = true`).
  const enabled = () =>
    enabledPluginIds(win).some(
      (id) => !isOfficialPluginId(id) || wantsStart(id, win),
    );
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
