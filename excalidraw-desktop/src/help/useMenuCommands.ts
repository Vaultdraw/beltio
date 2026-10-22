import { useEffect } from "react";

import { getAppCommandRunner } from "../commands/appRunner";

/** Native Help menu: Rust emits the palette command id to run. */
export function useMenuCommands(): void {
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("vault-run-command", (event) => {
          getAppCommandRunner()?.(event.payload);
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          off = unlisten;
        }
      })
      .catch(() => {
        // Not running inside Tauri.
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
}
