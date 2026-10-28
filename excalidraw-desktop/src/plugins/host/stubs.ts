/**
 * Registers a plugin's declared contributions as stubs. No plugin code runs:
 * a stub command or panel activates the plugin on first use.
 */
import { registerActivityEntries } from "../../activityBar/activityBarRegistry";
import {
  IconBookmark,
  IconGallery,
  IconGraph,
  IconHistory,
  IconKeyboard,
  IconLayout,
  IconLibrary,
  IconLink,
  IconPage,
  IconSearch,
  IconSettings,
  IconTag,
  IconTemplate,
} from "../../components/Icons";
import { registerCommands } from "../../commands/registry";
import { registerCommandHandlers } from "../../commands/handlerRegistry";
import { panelFlag, togglePanel } from "../../slots/panelStore";
import { toastStore } from "../../toasts/toastStore";
import { claimsPath } from "../../../../sdk/api/shared/viewNames";
import { registerTabKind } from "../../tabs/tabKinds";
import { claimImporter } from "../importerMapAdmin";
import { addMenuItems, beginMenuRun } from "../menuRegistry";
import { addToolbarButtons } from "../toolbarRegistry";
import { addToolStubs, type ToolStub } from "../toolRegistry";
import { getShapeInserter } from "../shapeRegistry";
import { registerPluginSettings } from "../settings/registry";

import { ensureActive } from "./activation";
import { releasePluginTools, toggleTool } from "./toolEngine";
import { setRegistrationCounts } from "./cost";
import { reportPluginError, reportPluginProblem, errorText } from "./errors";
import { guard } from "./guard";
import { addPluginPanels, type PluginPanelStub } from "./panelRegistry";

import type { ActivityEntry } from "../../activityBar/entries";
import type {
  CommandDefinition,
  CommandHandlers,
  WhenClause,
} from "../../commands/types";
import type { ViewProps } from "../api";
import type { PluginRuntime } from "./types";
import type { ComponentType } from "react";

const ICONS: Record<string, ActivityEntry["icon"]> = {
  library: IconLibrary,
  history: IconHistory,
  graph: IconGraph,
  gallery: IconGallery,
  bookmark: IconBookmark,
  search: IconSearch,
  tag: IconTag,
  template: IconTemplate,
  settings: IconSettings,
  keyboard: IconKeyboard,
  link: IconLink,
  page: IconPage,
};

/** Plugin panel buttons shown in the activity bar by default; the rest are opt-in. */
/** Plugin views win a tie with the built-in note view (priority 0). */
export const PLUGIN_VIEW_PRIORITY = 10;
export const ACTIVITY_BAR_PLUGIN_CAP = 6;
const shownPanelEntries = new Set<string>();

/** Built-in panel icon names a manifest may use. */
export const PANEL_ICON_NAMES: readonly string[] = Object.keys(ICONS);

/** The icon for a manifest name; an unknown name is reported, not silent. */
const iconFor = (pluginId: string, name: string | null) => {
  if (name && !(name in ICONS)) {
    reportPluginProblem(pluginId, `unknown icon ${name}; using the default`);
  }
  return (name && ICONS[name]) || IconLayout;
};

/** Run the plugin's real handler for `short` (activation already done). */
function runReal(rt: PluginRuntime, short: string) {
  const { id } = rt.info;
  const handler = rt.handlers.get(short);
  if (!handler) {
    const message = `command ${id}.${short} declared but not registered`;
    reportPluginError(id, new Error(message), "command");
    toastStore.push({ message: `${rt.info.name}: ${message}`, kind: "error" });
    return undefined;
  }
  // Each failure is toasted (then rethrown so the guard attributes and counts it).
  const failed = (err: unknown): never => {
    toastStore.push({
      message: `${rt.info.name}: command ${short} failed: ${errorText(err)}`,
      kind: "error",
    });
    throw err;
  };
  const run = () => {
    // A menu item that started this command makes its target readable until the command ends.
    const end = beginMenuRun(id, `${id}.${short}`);
    try {
      const result = handler();
      if (result instanceof Promise) {
        return result.catch(failed).finally(end);
      }
      end();
      return result;
    } catch (err) {
      end();
      return failed(err);
    }
  };
  return guard(id, run, `command ${short}`, true)();
}

/** Stub handler: run directly when active, else activate first (replay). */
const stubHandler = (rt: PluginRuntime, short: string) => () =>
  rt.state === "active"
    ? runReal(rt, short)
    : ensureActive(rt.info.id).then((ok) =>
        ok ? runReal(rt, short) : undefined,
      );

/** Declared tools: palette commands (added to `defs`/`handlers`), toolbar buttons and the stubs the engine reads. */
function registerToolStubs(
  rt: PluginRuntime,
  stubs: readonly ToolStub[],
  defs: CommandDefinition[],
  handlers: CommandHandlers,
  disposers: (() => void)[],
): void {
  const id = rt.info.id;
  for (const t of stubs) {
    handlers[t.command] = () => toggleTool(t, () => ensureActive(id));
    defs.push({
      id: t.command,
      title: `Tool: ${t.title}`,
      category: rt.info.name,
      keys: { default: [] },
    });
  }
  disposers.push(addToolStubs(stubs));
  disposers.push(
    addToolbarButtons(
      stubs.map((t) => ({
        pluginId: id,
        pluginName: rt.info.name,
        title: t.title,
        icon: t.icon,
        priority: 0,
        command: t.command,
        toolKey: t.key,
      })),
    ),
  );
  disposers.push(() => releasePluginTools(id));
}

/** Declared shapes: "Insert shape: <title>" commands and toolbar buttons. */
function registerShapeStubs(
  rt: PluginRuntime,
  defs: CommandDefinition[],
  handlers: CommandHandlers,
  disposers: (() => void)[],
): void {
  const { id, name } = rt.info;
  const buttons = (rt.info.contributes.shapes ?? []).map((s) => {
    const command = `${id}.shape.${s.id}`;
    const run = async () => {
      const ok = rt.state === "active" || (await ensureActive(id));
      const insert = ok ? getShapeInserter(`${id}.${s.id}`) : undefined;
      if (!ok) {
        return;
      }
      try {
        if (!insert) {
          throw new Error(`shape ${s.id} declared but not registered`);
        }
        await insert();
      } catch (err) {
        toastStore.push({
          message: `${name}: ${errorText(err)}`,
          kind: "error",
        });
      }
    };
    handlers[command] = run;
    defs.push({
      id: command,
      title: `Insert shape: ${s.title}`,
      category: name,
      keys: { default: [] },
    });
    return {
      pluginId: id,
      pluginName: name,
      title: s.title,
      icon: s.icon,
      priority: 0,
      command,
    };
  });
  disposers.push(addToolbarButtons(buttons));
}

/** Returns one disposer for everything registered; also stored on `rt`. */
export function registerStubs(rt: PluginRuntime): () => void {
  const { info } = rt;
  const id = info.id;
  const disposers: (() => void)[] = [];
  const handlers: CommandHandlers = {};

  const defs: CommandDefinition[] = info.contributes.commands.map((c) => {
    handlers[`${id}.${c.id}`] = stubHandler(rt, c.id);
    return {
      id: `${id}.${c.id}`,
      title: c.title,
      category: info.name,
      keys: { default: c.keys },
      when: c.when as WhenClause[],
      palette: c.palette,
      ...(c.repeat ? { repeat: true } : {}),
    };
  });

  const entries: ActivityEntry[] = [];
  const panels: PluginPanelStub[] = info.contributes.panels.map((p) => {
    const panelId = `${id}.${p.id}`;
    const commandId = `${id}.panel.${p.id}`;
    handlers[commandId] = () => togglePanel(panelId);
    defs.push({
      id: commandId,
      title: `Toggle ${p.title} panel`,
      category: info.name,
      keys: { default: [] },
    });
    const defaultHidden = shownPanelEntries.size >= ACTIVITY_BAR_PLUGIN_CAP;
    if (!defaultHidden) {
      shownPanelEntries.add(panelId);
    }
    entries.push({
      id: panelId,
      defaultHidden,
      label: p.title,
      icon: iconFor(id, p.icon),
      commandId,
      group: p.group,
      active: panelFlag(panelId),
    });
    return {
      id: panelId,
      pluginId: id,
      title: p.title,
      load: async () => {
        const ok = await ensureActive(id);
        const component = ok ? rt.components.get(p.id) : undefined;
        if (!component) {
          throw new Error(`panel ${panelId} declared but not registered`);
        }
        return { default: component };
      },
    };
  });

  // Declared tools: a palette command that toggles the tool and a toolbar button; the plugin loads on first use.
  const toolStubs: ToolStub[] = (info.contributes.tools ?? []).map((t) => ({
    key: `${id}.${t.id}`,
    pluginId: id,
    pluginName: info.name,
    id: t.id,
    title: t.title,
    icon: t.icon,
    cursor: t.cursor ?? "crosshair",
    command: `${id}.tool.${t.id}`,
  }));
  if (toolStubs.length > 0) {
    registerToolStubs(rt, toolStubs, defs, handlers, disposers);
  }
  // Declared shapes: a palette command and a toolbar button that insert the shape; the plugin loads on first use.
  const shapes = info.contributes.shapes ?? [];
  if (shapes.length > 0) {
    registerShapeStubs(rt, defs, handlers, disposers);
  }
  disposers.push(registerCommands(defs));
  disposers.push(registerCommandHandlers(handlers));
  disposers.push(registerActivityEntries(entries));
  disposers.push(addPluginPanels(panels));
  if (info.contributes.settings.length > 0) {
    try {
      disposers.push(registerPluginSettings(id, info.contributes.settings));
    } catch (err) {
      reportPluginProblem(id, errorText(err));
    }
  }
  // A declared importer claims its extensions now; the plugin loads on the first matching file.
  for (const imp of info.contributes.importers ?? []) {
    disposers.push(
      claimImporter(
        { pluginId: id, importerId: imp.id, title: imp.title },
        imp.extensions,
      ),
    );
  }
  // Declared menu items are shown by the menus themselves; choosing one runs a stub command.
  const menus = (info.contributes.menus ?? []).map((m) => ({
    pluginId: id,
    pluginName: info.name,
    surface: m.surface,
    title:
      m.title ??
      info.contributes.commands.find((c) => c.id === m.command)?.title ??
      m.command,
    command: `${id}.${m.command}`,
    kinds: m.kinds,
  }));
  disposers.push(addMenuItems(menus));
  // Declared toolbar buttons are drawn by the editor strip; a click runs a stub command.
  disposers.push(
    addToolbarButtons(
      (info.contributes.toolbar ?? []).map((b) => {
        const title =
          b.title ??
          info.contributes.commands.find((c) => c.id === b.command)?.title ??
          b.command;
        return {
          pluginId: id,
          pluginName: info.name,
          title,
          icon: b.icon,
          priority: b.priority,
          command: `${id}.${b.command}`,
        };
      }),
    ),
  );
  // A declared view claims its note names now; the plugin loads when the first such tab shows.
  for (const v of info.contributes.views ?? []) {
    disposers.push(
      registerTabKind({
        id: `${id}.${v.id}`,
        pluginId: id,
        priority: PLUGIN_VIEW_PRIORITY,
        matches: (path) => claimsPath(v.extensions, path),
        load: async () => {
          const ok = await ensureActive(id);
          const component = ok ? rt.components.get(`view:${v.id}`) : undefined;
          if (!component) {
            throw new Error(`view ${id}.${v.id} declared but not registered`);
          }
          const { asKindView } = await import("./pluginViews");
          return {
            default: asKindView(
              id,
              rt.info.permissions,
              component as ComponentType<ViewProps>,
            ),
          };
        },
      }),
    );
  }
  setRegistrationCounts(
    id,
    {
      commands: defs.length,
      panels: panels.length,
      settings: info.contributes.settings.length,
    },
    info.mainBytes,
  );
  return () => {
    disposers.reverse().forEach((d) => d());
    panels.forEach((p) => shownPanelEntries.delete(p.id));
  };
}
