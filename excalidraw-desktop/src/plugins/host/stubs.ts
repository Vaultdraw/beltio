/**
 * Registers a plugin's declared contributions as stubs. No plugin code runs:
 * a stub command or panel activates the plugin on first use.
 */
import { registerActivityEntries } from "../../activityBar/activityBarRegistry";
import {
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
import { registerPluginSettings } from "../settings/registry";

import { ensureActive } from "./activation";
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
import type { PluginRuntime } from "./types";

const ICONS: Record<string, ActivityEntry["icon"]> = {
  library: IconLibrary,
  history: IconHistory,
  graph: IconGraph,
  gallery: IconGallery,
  search: IconSearch,
  tag: IconTag,
  template: IconTemplate,
  settings: IconSettings,
  keyboard: IconKeyboard,
  link: IconLink,
  page: IconPage,
};

const iconFor = (name: string | null) => (name && ICONS[name]) || IconLayout;

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
  return guard(id, handler, `command ${short}`, true)();
}

/** Stub handler: run directly when active, else activate first (replay). */
const stubHandler = (rt: PluginRuntime, short: string) => () =>
  rt.state === "active"
    ? runReal(rt, short)
    : ensureActive(rt.info.id).then((ok) =>
        ok ? runReal(rt, short) : undefined,
      );

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
    entries.push({
      id: panelId,
      label: p.title,
      icon: iconFor(p.icon),
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
  setRegistrationCounts(
    id,
    {
      commands: defs.length,
      panels: panels.length,
      settings: info.contributes.settings.length,
    },
    info.mainBytes,
  );
  return () => disposers.reverse().forEach((d) => d());
}
