/**
 * Registry entries (metadata only) for commands whose handlers the open
 * editor binds through registerCommandHandlers (paper, library, ...).
 * Spread into COMMANDS (commands.ts). No default keys: rebindable on the
 * Hotkeys page.
 */
import {
  PAGE_SIZE_PRESET_IDS,
  PAGE_SIZE_PRESETS,
  PAPER_THEME_LABELS,
  PAPER_THEMES,
} from "@excalidraw/excalidraw/data/pageSetup";

import { PAPER_STYLES } from "../components/paper/paperStyles";

import type { CommandDefinition } from "./types";

export const paperCommandId = (style: string) => `paper.${style}`;

const PAPER_COMMANDS: CommandDefinition[] = [
  ...PAPER_STYLES.map(
    (style): CommandDefinition => ({
      id: paperCommandId(style.id),
      title: `Paper: ${style.label}`,
      category: "Paper",
      keys: { default: [] },
      when: ["drawingOpen", "writable"],
    }),
  ),
  {
    id: "paper.settings",
    title: "Paper settings…",
    category: "Paper",
    keys: { default: [] },
    when: ["drawingOpen", "writable"],
  },
];

export const pageSizeCommandId = (size: string) => `page.size.${size}`;
export const pageLayoutCommandId = (layout: string) => `page.layout.${layout}`;
export const pageOrientationCommandId = (orientation: string) =>
  `page.orientation.${orientation}`;
export const pagePaperCommandId = (theme: string) => `page.paper.${theme}`;

const pageCommand = (
  id: string,
  title: string,
  extra: Partial<CommandDefinition> = {},
): CommandDefinition => ({
  id,
  title,
  category: "Page",
  keys: { default: [] },
  when: ["drawingOpen", "writable"],
  ...extra,
});

const PAGE_COMMANDS: CommandDefinition[] = [
  pageCommand("page.on", "Page mode: On"),
  pageCommand("page.off", "Page mode: Off"),
  pageCommand("page.toggle", "Page mode: Toggle"),
  pageCommand(pageLayoutCommandId("continuous"), "Page layout: Continuous"),
  pageCommand(pageLayoutCommandId("separate"), "Page layout: Separate pages"),
  ...PAGE_SIZE_PRESET_IDS.map((id) =>
    pageCommand(
      pageSizeCommandId(id),
      `Page size: ${PAGE_SIZE_PRESETS[id].label}`,
    ),
  ),
  pageCommand(
    pageOrientationCommandId("portrait"),
    "Page orientation: Portrait",
  ),
  pageCommand(
    pageOrientationCommandId("landscape"),
    "Page orientation: Landscape",
  ),
  pageCommand("page.setup", "Page setup…"),
  ...PAPER_THEMES.map((theme) =>
    pageCommand(
      pagePaperCommandId(theme),
      `Paper theme: ${PAPER_THEME_LABELS[theme]}`,
    ),
  ),
  pageCommand("page.fitContent", "Fit content to page"),
  // Navigation is read-only safe. Bound only while page mode is on, so
  // PageUp/PageDown keep scrolling the infinite canvas otherwise.
  pageCommand("page.next", "Next page", {
    keys: { default: ["PageDown"] },
    when: ["drawingOpen", "canvasFocus"],
  }),
  pageCommand("page.previous", "Previous page", {
    keys: { default: ["PageUp"] },
    when: ["drawingOpen", "canvasFocus"],
  }),
];

export const EDITOR_COMMANDS: readonly CommandDefinition[] = [
  ...PAPER_COMMANDS,
  ...PAGE_COMMANDS,
  {
    id: "markdown.toggle",
    title: "Markdown mode: On or off",
    category: "Markdown",
    keys: { default: ["Mod+Alt+M"] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "markdown.toggleTask",
    title: "Markdown: Toggle task",
    category: "Markdown",
    keys: { default: ["Mod+L"] },
    when: ["drawingOpen", "writable"],
  },
  {
    id: "library.toggle",
    title: "Library: Open/close",
    category: "Library",
    keys: { default: [] },
    when: ["drawingOpen"],
  },
];
