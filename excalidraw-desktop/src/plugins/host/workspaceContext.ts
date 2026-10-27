/** `ctx.workspace`: open a drawing and read the active path, through the shell's bridge. */
import { PluginApiError } from "../../../../sdk/api/shared/rules";
import { checkVaultPath } from "../../../../sdk/api/shared/vaultPaths";
import { useFolderEntries } from "../folderContext";
import { getWorkspaceBridge } from "../workspaceBridge";

import type { WorkspaceApi } from "../api";

export function createWorkspaceApi(): WorkspaceApi {
  return {
    async open(path, opts) {
      checkVaultPath(path, "file");
      const bridge = getWorkspaceBridge();
      if (!bridge?.vault()) {
        throw new PluginApiError("NO_VAULT", "No vault is open");
      }
      if (!(await bridge.drawingExists(path))) {
        throw new PluginApiError("NOT_FOUND", `Drawing not found: ${path}`);
      }
      if (!(await bridge.openDrawing(path, opts?.newTab === true))) {
        throw new PluginApiError("IO_ERROR", `Could not open ${path}`);
      }
    },
    activePath: () => getWorkspaceBridge()?.activePath() ?? null,
    useFolder: (path) => {
      checkVaultPath(path, "folder");
      return useFolderEntries(path);
    },
  };
}
