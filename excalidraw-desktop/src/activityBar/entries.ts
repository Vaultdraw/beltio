/**
 * The activity bar's entries: one row per panel or action. A future feature
 * adds one entry here (its command must be a registered CommandDefinition).
 * `resolveEntryState` is pure: the component feeds it the live command facts.
 */
import { libraryPanelStore } from "../library/libraryPanelState";
import {
  IconGallery,
  IconGraph,
  IconHistory,
  IconKeyboard,
  IconLibrary,
  IconSearch,
  IconSettings,
  IconTag,
  IconTemplate,
} from "../components/Icons";
import {
  isHistoryPanelOpen,
  subscribeHistoryPanelOpen,
} from "../history/historyPanelState";

import { registerActivityEntries } from "./activityBarRegistry";
import { galleryPanelStore, graphPanelStore } from "./panelStores";

import type { ComponentType, SVGProps } from "react";

export type ActivityGroup = "top" | "bottom";

/** A boolean that can be watched (see flagStore). */
export interface ActiveStore {
  subscribe(listener: () => void): () => void;
  get(): boolean;
}

export interface ActivityEntry {
  /** Test id suffix: `activity-bar-<id>`. */
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Run through the command dispatcher, like the palette. */
  commandId: string;
  group: ActivityGroup;
  /** The panel this opens is showing: the button is pressed. */
  active?: ActiveStore;
  /**
   * Works on the open drawing: without one the entry is shown disabled with
   * "Open a drawing first" (even when the editor that binds it is unmounted).
   */
  needsDrawing?: boolean;
  /** Hidden until the user shows it (see layout.ts); plugin panels past the cap. */
  defaultHidden?: boolean;
}

export const OPEN_DRAWING = "Open a drawing first";

export const ACTIVITY_ENTRIES: readonly ActivityEntry[] = [
  {
    id: "library",
    label: "Library",
    icon: IconLibrary,
    commandId: "library.toggle",
    group: "top",
    active: libraryPanelStore,
    needsDrawing: true,
  },
  {
    id: "history",
    label: "History",
    icon: IconHistory,
    commandId: "history.toggle",
    group: "top",
    active: {
      subscribe: subscribeHistoryPanelOpen,
      get: isHistoryPanelOpen,
    },
    needsDrawing: true,
  },
  {
    id: "graph",
    label: "Graph view",
    icon: IconGraph,
    commandId: "graph.open",
    group: "top",
    active: graphPanelStore,
  },
  {
    id: "gallery",
    label: "Gallery",
    icon: IconGallery,
    commandId: "thumbnails.galleryToggle",
    group: "top",
    active: galleryPanelStore,
  },
  {
    id: "search",
    label: "Search",
    icon: IconSearch,
    commandId: "navigator.focusSearch",
    group: "top",
  },
  {
    id: "tags",
    label: "Tags",
    icon: IconTag,
    commandId: "tags.focusPane",
    group: "top",
  },
  {
    id: "templates",
    label: "Templates",
    icon: IconTemplate,
    commandId: "vault.newFromTemplate",
    group: "top",
  },
  {
    id: "hotkeys",
    label: "Hotkeys",
    icon: IconKeyboard,
    commandId: "settings.openHotkeys",
    group: "bottom",
  },
  {
    id: "settings",
    label: "Settings",
    icon: IconSettings,
    commandId: "settings.open",
    group: "bottom",
  },
];

registerActivityEntries(ACTIVITY_ENTRIES);

/** Live facts about a command, supplied by the component. */
export interface EntryContext {
  drawingOpen: boolean;
  /** Some component bound a handler for the command. */
  hasHandler(commandId: string): boolean;
  /** The handler is bound and the command's `when` holds. */
  isAvailable(commandId: string): boolean;
  /** First chord label, "" when unassigned. */
  shortcut(commandId: string): string;
}

export interface EntryState {
  /** No handler bound: the entry is not offered at all. */
  hidden: boolean;
  disabled: boolean;
  /** Native tooltip: "Label (Shortcut)", "Label" or "Label - reason". */
  title: string;
}

export function resolveEntryState(
  entry: ActivityEntry,
  ctx: EntryContext,
): EntryState {
  if (entry.needsDrawing && !ctx.drawingOpen) {
    return {
      hidden: false,
      disabled: true,
      title: `${entry.label} - ${OPEN_DRAWING}`,
    };
  }
  if (!ctx.hasHandler(entry.commandId)) {
    return { hidden: true, disabled: true, title: entry.label };
  }
  if (!ctx.isAvailable(entry.commandId)) {
    return {
      hidden: false,
      disabled: true,
      title: `${entry.label} - Not available now`,
    };
  }
  const keys = ctx.shortcut(entry.commandId);
  return {
    hidden: false,
    disabled: false,
    title: keys ? `${entry.label} (${keys})` : entry.label,
  };
}
