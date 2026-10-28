import { useMemo } from "react";

import { getMenuItems, runMenuItem } from "../../plugins/menuRegistry";

import { ContextMenu } from "./ContextMenu";
import {
  buildRowMenu,
  type PluginRowItem,
  type RowMenuActions,
} from "./rowMenuModel";

import type { VaultEntry } from "../../vault/types";

export interface RowMenuState {
  entry: VaultEntry;
  x: number;
  y: number;
}

interface RowMenuProps {
  state: RowMenuState;
  readOnly: boolean;
  ownerDocument?: Document | null;
  onClose: () => void;
  actions: RowMenuActions;
}

/** Row actions shown from the "More actions" button, a right-click or `list.menu`. */
export const RowMenu = ({
  state,
  readOnly,
  ownerDocument,
  onClose,
  actions,
}: RowMenuProps) => {
  const { entry } = state;
  const nodes = useMemo(() => {
    const rowKind =
      entry.kind === "folder"
        ? "folder"
        : entry.kind === "drawing"
        ? "drawing"
        : "note";
    // Items plugins declared for tree rows (`[[contributes.menus]]`), filtered by the row's kind.
    const pluginItems: PluginRowItem[] = getMenuItems("tree")
      .filter((it) => it.kinds.length === 0 || it.kinds.includes(rowKind))
      .map((it) => ({
        command: it.command,
        title: it.title,
        run: () =>
          runMenuItem(it, {
            surface: "tree",
            path: entry.path,
            kind: entry.kind === "excalidrawMd" ? "other" : rowKind,
          }),
      }));
    return buildRowMenu({ entry, readOnly, actions, pluginItems });
  }, [entry, readOnly, actions]);

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      label={`Actions for ${entry.name}`}
      ownerDocument={ownerDocument}
      onClose={onClose}
      nodes={nodes}
    />
  );
};
