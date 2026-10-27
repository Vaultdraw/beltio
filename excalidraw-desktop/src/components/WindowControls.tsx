/** Minimize, maximize-restore and close buttons for the Linux custom title bar. */
import { useEffect, useState } from "react";

import { WINDOW_COMMAND_IDS } from "../commands/windowCommands";
import { registerCommandHandlers } from "../commands/handlerRegistry";
import { runWindowAction } from "../vault/windowChrome";

import {
  IconWindowClose,
  IconWindowMaximize,
  IconWindowMinimize,
  IconWindowRestore,
} from "./Icons";

export const WindowControls = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    const sync = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const current = getCurrentWindow();
      const read = async () => {
        const value = await current.isMaximized();
        if (!gone) {
          setMaximized(value);
        }
      };
      await read();
      const unlisten = await current.onResized(() => void read());
      if (gone) {
        unlisten();
      } else {
        off = unlisten;
      }
    };
    void sync().catch(() => {});
    const unbind = registerCommandHandlers({
      [WINDOW_COMMAND_IDS.minimize]: () => runWindowAction("minimize"),
      [WINDOW_COMMAND_IDS.toggleMaximize]: () =>
        runWindowAction("toggleMaximize"),
    });
    return () => {
      gone = true;
      off?.();
      unbind();
    };
  }, []);

  return (
    <div className="vault-window-controls" role="group" aria-label="Window">
      <button
        type="button"
        className="vault-ibtn"
        title="Minimize"
        aria-label="Minimize window"
        onClick={() => void runWindowAction("minimize")}
      >
        <IconWindowMinimize />
      </button>
      <button
        type="button"
        className="vault-ibtn"
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore window" : "Maximize window"}
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        {maximized ? <IconWindowRestore /> : <IconWindowMaximize />}
      </button>
      <button
        type="button"
        className="vault-ibtn vault-window-controls__close"
        title="Close"
        aria-label="Close window"
        onClick={() => void runWindowAction("close")}
      >
        <IconWindowClose />
      </button>
    </div>
  );
};
