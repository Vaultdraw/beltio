/**
 * Keyboard-first guard (philosophy audit check 4): a user-facing action must have a command in the
 * registry (palette, rebindable). Fails when a new click handler appears in an audited surface
 * without being classified, when a named command is not registered, or when a KNOWN gap was fixed
 * (so the list can only shrink).
 *
 * Each row: a file, its exact count of `onClick=` / `onSelect=` handlers, the commands that back
 * its actions, handlers that are plumbing (picking a row, a dialog's close X: not actions), and
 * GAPS: user actions with no command yet. A new gap needs a written reason in the row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRowMenu } from "../components/menu/rowMenuModel";
import { buildEntries } from "../tabs/TabContextMenu";

import { getCommand } from "./commands";

import type { MenuNode } from "../components/menu/menuModel";
import type { VaultEntry } from "../vault/types";

type Surface = {
  file: string;
  handlers: number;
  commands: string[];
  plumbing: number;
  gaps: { what: string }[];
};

const SURFACES: Surface[] = [
  {
    file: "history/panel/PreviewOverlay.tsx",
    handlers: 4,
    commands: [
      "history.toggleHighlights",
      "history.restore",
      "history.copySelection",
      "history.backToCurrent",
    ],
    plumbing: 0,
    gaps: [],
  },
  {
    file: "history/panel/HistoryPanel.tsx",
    handlers: 3,
    commands: ["history.timeTravel"],
    plumbing: 2,
    gaps: [],
  },
  {
    file: "history/panel/VersionRow.tsx",
    handlers: 2,
    commands: ["history.deleteCheckpoint"],
    plumbing: 1,
    gaps: [],
  },
  {
    file: "history/GitNotice.tsx",
    handlers: 2,
    commands: ["history.excludeFromGit", "history.dismissGitNotice"],
    plumbing: 0,
    gaps: [],
  },
  {
    file: "templates/TemplatePicker.tsx",
    handlers: 3,
    commands: ["templates.revealGlobal"],
    plumbing: 2,
    gaps: [],
  },
  {
    file: "components/tags/TagsPanel.tsx",
    handlers: 5,
    commands: ["tags.toggleSection", "tags.toggleSort", "tags.rename"],
    plumbing: 2,
    gaps: [],
  },
  {
    file: "components/links/LinksDock.tsx",
    handlers: 6,
    // The Create button: Enter (list.open) on an unresolved row creates it too.
    commands: ["links.showBacklinks", "links.showOutgoing", "list.open"],
    plumbing: 3,
    gaps: [],
  },
  {
    file: "tabs/TabStrip.tsx",
    handlers: 5,
    commands: ["tabs.close", "tabs.new", "tabs.showAll"],
    plumbing: 1,
    gaps: [],
  },
  {
    file: "tabs/TabListPopover.tsx",
    handlers: 1,
    commands: [],
    plumbing: 1,
    gaps: [],
  },
  {
    file: "page/PageNotice.tsx",
    handlers: 2,
    commands: ["page.fitContent", "page.dismissNotice"],
    plumbing: 0,
    gaps: [],
  },
  {
    file: "components/page/PageMenuItem.tsx",
    handlers: 1,
    commands: ["page.setup"],
    plumbing: 0,
    gaps: [],
  },
];

const SRC = join(__dirname, "..");
const countHandlers = (file: string) =>
  (readFileSync(join(SRC, file), "utf8").match(/\bon(?:Click|Select)=/g) ?? [])
    .length;

describe("every audited click action has a command", () => {
  it.each(SURFACES.map((s) => [s.file, s] as const))(
    "%s: handlers are classified and commands exist",
    (_file, s) => {
      expect(countHandlers(s.file), "unclassified handler: add a row").toBe(
        s.handlers,
      );
      // Distinct commands may back several handlers (two buttons, one action).
      expect(
        s.commands.length + s.plumbing + s.gaps.length,
      ).toBeLessThanOrEqual(s.handlers);
      for (const id of s.commands) {
        expect(getCommand(id), `${id} is not in the registry`).toBeTruthy();
      }
    },
  );

  it("KNOWN gaps (must shrink, never grow)", () => {
    const gaps = SURFACES.flatMap((s) =>
      s.gaps.map((g) => `${s.file}: ${g.what}`),
    );
    expect(gaps).toEqual([]);
  });
});

const entry = (kind: VaultEntry["kind"], sync?: string): VaultEntry =>
  ({
    name: "a",
    path: "a",
    kind,
    ...(sync ? { sync } : {}),
  } as unknown as VaultEntry);

const flatten = (nodes: readonly MenuNode[]): MenuNode[] =>
  nodes.flatMap((n) => (n.kind === "submenu" ? flatten(n.items) : [n]));

/** Row-menu items with no command today (none left: compare and download got theirs). */
const ROW_MENU_GAPS = new Set<string>([]);

describe("the file tree row menu", () => {
  const noop = () => {};
  const actions = {
    newInside: noop,
    duplicate: noop,
    saveAsTemplate: noop,
    rename: noop,
    move: noop,
    reveal: noop,
    exportAs: noop,
    trash: noop,
    localGraph: noop,
    history: noop,
    syncAction: noop,
    copyPath: noop,
  };
  const menus = (
    ["folder", "drawing", "note", "other"] as VaultEntry["kind"][]
  ).flatMap((kind) =>
    [false, true].flatMap((readOnly) =>
      ["conflict", "placeholder", undefined].map((sync) =>
        flatten(
          buildRowMenu({
            entry: entry(kind, sync),
            readOnly,
            actions,
            pluginItems: [],
          }),
        ),
      ),
    ),
  );
  const items = menus
    .flat()
    .filter((n): n is Extract<MenuNode, { kind: "item" }> => n.kind === "item");

  it("every item has a registered command, except the known gaps", () => {
    const missing = new Set(items.filter((i) => !i.commandId).map((i) => i.id));
    expect([...missing].sort()).toEqual([...ROW_MENU_GAPS].sort());
    for (const i of items) {
      if (i.commandId) {
        expect(getCommand(i.commandId), `${i.id}: ${i.commandId}`).toBeTruthy();
      }
    }
  });
});

describe("the tab context menu", () => {
  const TAB_COMMAND: Record<string, string> = {
    close: "tabs.close",
    closeOthers: "tabs.closeOthers",
    closeRight: "tabs.closeRight",
    closeAll: "tabs.closeAll",
    pin: "tabs.togglePin",
    copyPath: "tabs.copyPath",
    reveal: "tabs.reveal",
  };
  it("every action maps to a registered command", () => {
    const fn = () => {};
    const entries = buildEntries({
      tab: { id: "t", path: "a.excalidraw", pinned: false },
      onClose: fn,
      onCloseOthers: fn,
      onCloseRight: fn,
      onCloseAll: fn,
      onTogglePin: fn,
      onCopyPath: fn,
      onReveal: fn,
    } as unknown as Parameters<typeof buildEntries>[0]);
    const actions = entries
      .map((e) => e.action)
      .filter((a) => a !== "sep" && !a.startsWith("plugin:"));
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(
        TAB_COMMAND[a],
        `tab menu action ${a} has no command`,
      ).toBeTruthy();
      expect(getCommand(TAB_COMMAND[a])).toBeTruthy();
    }
  });
});
