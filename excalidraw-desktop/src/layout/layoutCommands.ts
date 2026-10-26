/**
 * Layout commands. Built-in ones are static (spread into commands.ts); each
 * user preset gets a `layout.preset.<name>` command at runtime
 * (useLayout.ts). Handlers are bound by useLayout.ts.
 */
import { FOCUS_PRESET } from "./layoutSettings";

import type { CommandDefinition } from "../commands/types";

export const LAYOUT_PRESET_PREFIX = "layout.preset.";

export const LAYOUT_COMMAND_IDS = {
  focus: `${LAYOUT_PRESET_PREFIX}${FOCUS_PRESET}`,
  reset: "layout.reset",
  toggleHeader: "layout.toggleHeader",
  toggleFooter: "layout.toggleFooter",
} as const;

export const presetCommandId = (name: string): string =>
  `${LAYOUT_PRESET_PREFIX}${name}`;

const WHEN = ["vaultOpen", "!modalOpen"] as const;

export const presetCommand = (name: string): CommandDefinition => ({
  id: presetCommandId(name),
  title: `Layout: ${name}`,
  category: "View",
  keys: { default: [] },
  when: [...WHEN],
});

export const LAYOUT_COMMANDS: readonly CommandDefinition[] = [
  {
    id: LAYOUT_COMMAND_IDS.focus,
    title: "Layout: Focus mode",
    category: "View",
    keys: { default: ["Mod+Shift+Enter"] },
    when: [...WHEN],
  },
  {
    id: LAYOUT_COMMAND_IDS.reset,
    title: "Layout: Default layout",
    category: "View",
    keys: { default: [] },
    when: [...WHEN],
  },
  {
    id: LAYOUT_COMMAND_IDS.toggleHeader,
    title: "Layout: Toggle header",
    category: "View",
    keys: { default: [] },
    when: [...WHEN],
  },
  {
    id: LAYOUT_COMMAND_IDS.toggleFooter,
    title: "Layout: Toggle editor footer",
    category: "View",
    keys: { default: [] },
    when: [...WHEN],
  },
];
