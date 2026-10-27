/** The component a plugin view tab shows: the plugin's component inside an error boundary, with its file access. */
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";
import { getNoteFiles } from "../../notes/noteBackend";

import { PluginBoundary } from "./PluginBoundary";

import type { ComponentType } from "react";
import type { TabKindViewProps } from "../../tabs/tabKinds";
import type { ViewFile, ViewProps } from "../api";

/** The note's contents in the plugin's hands: guarded by the plugin's declared permissions. */
export function viewFile(
  pluginId: string,
  permissions: readonly string[],
  handle: string | null,
  path: string,
): ViewFile {
  const need = () => {
    if (handle === null) {
      throw new Error("Open a vault in the Vaultdraw app to read notes.");
    }
    return handle;
  };
  return {
    async read() {
      requirePermission(pluginId, permissions, "views file.read", "vault.read");
      const file = await getNoteFiles().read(need(), path);
      return { text: file.content, revision: file.revision };
    },
    async write(text, expectedRevision) {
      requirePermission(
        pluginId,
        permissions,
        "views file.write",
        "vault.write",
      );
      const done = await getNoteFiles().write(
        need(),
        path,
        text,
        expectedRevision,
      );
      return { revision: done.revision };
    },
  };
}

/** Wraps a plugin's view component as the component of a tab kind. */
export const asKindView =
  (
    pluginId: string,
    permissions: readonly string[],
    View: ComponentType<ViewProps>,
  ): ComponentType<TabKindViewProps> =>
  ({ path, openPath, vault }) =>
    (
      <PluginBoundary pluginId={pluginId} what="view">
        <View
          path={path}
          file={viewFile(pluginId, permissions, vault.handle, path)}
          openPath={openPath}
        />
      </PluginBoundary>
    );
