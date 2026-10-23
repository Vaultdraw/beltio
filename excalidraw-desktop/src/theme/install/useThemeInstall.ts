import { useEffect, useSyncExternalStore } from "react";

import { THEME_COMMAND_IDS } from "../../commands/themeCommands";
import { registerCommandHandlers } from "../../commands/handlerRegistry";

import {
  getInstallDialogRequest,
  openInstallDialog,
  subscribeInstallDialog,
} from "./installStore";

/** Binds the theme install commands; returns the open dialog request, if any. */
export const useThemeInstall = () => {
  useEffect(
    () =>
      registerCommandHandlers({
        [THEME_COMMAND_IDS.installFromUrl]: () =>
          openInstallDialog({ mode: "install" }),
        [THEME_COMMAND_IDS.update]: () => openInstallDialog({ mode: "update" }),
        [THEME_COMMAND_IDS.uninstall]: () =>
          openInstallDialog({ mode: "uninstall" }),
      }),
    [],
  );
  return useSyncExternalStore(
    subscribeInstallDialog,
    getInstallDialogRequest,
    getInstallDialogRequest,
  );
};
