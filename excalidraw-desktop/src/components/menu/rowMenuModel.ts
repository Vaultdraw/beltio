/**
 * The file tree's right-click menu, grouped like Obsidian's:
 * create / organise / copy path / reveal / plugin items / rename and trash.
 * Pure: `buildRowMenu` returns data; VaultNavigator supplies the actions.
 */
import { joinGroups, type MenuNode } from "./menuModel";

import type { ExplorerExportFormat } from "../../export/exportFromFile";
import type { VaultEntry } from "../../vault/types";

export type CopyPathKind = "relative" | "absolute" | "link";

export interface PluginRowItem {
  command: string;
  title: string;
  run: () => void;
}

export interface RowMenuActions {
  newInside: (folderPath: string, kind: "folder" | "drawing") => void;
  duplicate: (entry: VaultEntry) => void;
  saveAsTemplate?: (entry: VaultEntry) => void;
  rename: (entry: VaultEntry) => void;
  move: (entry: VaultEntry) => void;
  reveal: (entry: VaultEntry) => void;
  exportAs?: (entry: VaultEntry, format: ExplorerExportFormat) => void;
  trash: (entry: VaultEntry) => void;
  localGraph?: (entry: VaultEntry) => void;
  history?: (entry: VaultEntry) => void;
  syncAction?: (entry: VaultEntry, action: "compare" | "download") => void;
  copyPath: (entry: VaultEntry, kind: CopyPathKind) => void;
}

export interface RowMenuInput {
  entry: VaultEntry;
  readOnly: boolean;
  actions: RowMenuActions;
  /** Plugin items already filtered for this row's kind. */
  pluginItems: readonly PluginRowItem[];
}

export function buildRowMenu({
  entry,
  readOnly,
  actions: a,
  pluginItems,
}: RowMenuInput): MenuNode[] {
  const isFolder = entry.kind === "folder";
  // Notes and Obsidian Excalidraw files only offer copy path and reveal from the tree.
  const isDrawing = entry.kind === "drawing";
  const editable = !readOnly && (isFolder || isDrawing);
  const item = (
    id: string,
    label: string,
    run: () => void,
    extra: Partial<Extract<MenuNode, { kind: "item" }>> = {},
  ): MenuNode => ({ kind: "item", id, label, run, ...extra });

  const create: MenuNode[] =
    isFolder && !readOnly
      ? [
          item(
            "newDrawing",
            "New drawing",
            () => a.newInside(entry.path, "drawing"),
            { commandId: "list.newItem" },
          ),
          item(
            "newFolder",
            "New folder",
            () => a.newInside(entry.path, "folder"),
            { commandId: "list.newFolder" },
          ),
        ]
      : [];

  const exportItems: MenuNode[] =
    isDrawing && a.exportAs
      ? [
          { id: "exportPng", label: "Export as PNG…", format: "png" as const },
          { id: "exportSvg", label: "Export as SVG…", format: "svg" as const },
          { id: "exportPdf", label: "Export as PDF…", format: "pdf" as const },
          { id: "saveCopy", label: "Save a copy…", format: "copy" as const },
        ].map((e) =>
          item(e.id, e.label, () => a.exportAs?.(entry, e.format), {
            commandId: `list.${e.id}`,
          }),
        )
      : [];

  const organise: MenuNode[] = [
    ...(isDrawing && !readOnly
      ? [
          item("duplicate", "Duplicate", () => a.duplicate(entry), {
            commandId: "list.duplicate",
          }),
        ]
      : []),
    ...(isDrawing && a.saveAsTemplate
      ? [
          item(
            "saveAsTemplate",
            "Save as template…",
            () => a.saveAsTemplate?.(entry),
            { commandId: "list.saveAsTemplate" },
          ),
        ]
      : []),
    ...(editable
      ? [
          item("move", "Move to…", () => a.move(entry), {
            commandId: "list.move",
          }),
        ]
      : []),
    ...(isDrawing && a.localGraph
      ? [
          item("localGraph", "Open local graph", () => a.localGraph?.(entry), {
            commandId: "list.localGraph",
          }),
        ]
      : []),
    ...(isDrawing && a.history
      ? [
          item("history", "History", () => a.history?.(entry), {
            commandId: "list.history",
          }),
        ]
      : []),
    ...(isDrawing && entry.sync === "conflict" && a.syncAction
      ? [
          item("compare", "Compare with original…", () =>
            a.syncAction?.(entry, "compare"),
          ),
        ]
      : []),
    ...(entry.sync === "placeholder" && a.syncAction
      ? [
          item("download", "Download from iCloud", () =>
            a.syncAction?.(entry, "download"),
          ),
        ]
      : []),
    ...(exportItems.length > 0
      ? [
          {
            kind: "submenu" as const,
            id: "export",
            label: "Export",
            items: exportItems,
          },
        ]
      : []),
  ];

  const copy: MenuNode = {
    kind: "submenu",
    id: "copyPath",
    label: "Copy path",
    items: [
      item(
        "copyRelative",
        "Relative to vault",
        () => a.copyPath(entry, "relative"),
        {
          commandId: "list.copyPath",
        },
      ),
      item(
        "copyAbsolute",
        "Absolute path",
        () => a.copyPath(entry, "absolute"),
        {
          commandId: "list.copyAbsolutePath",
        },
      ),
      // A vaultdraw:// link opens drawings and notes, not folders.
      ...(isFolder
        ? []
        : [
            item("copyLink", "Link", () => a.copyPath(entry, "link"), {
              commandId: "list.copyLink",
            }),
          ]),
    ],
  };

  const reveal: MenuNode[] = [
    item("reveal", "Reveal in file manager", () => a.reveal(entry), {
      commandId: "list.reveal",
    }),
  ];

  const plugins: MenuNode[] = pluginItems.map((p) =>
    item(`plugin:${p.command}:${p.title}`, p.title, p.run),
  );

  const last: MenuNode[] = editable
    ? [
        item("rename", "Rename…", () => a.rename(entry), {
          commandId: "list.rename",
        }),
        item("trash", "Move to Trash", () => a.trash(entry), {
          danger: true,
          commandId: "list.delete",
        }),
      ]
    : [];

  return joinGroups([create, organise, [copy], reveal, plugins, last]);
}
