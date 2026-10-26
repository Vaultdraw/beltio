import { useSyncExternalStore } from "react";

import { openConfigDir } from "../vault/settingsSync";

import { restartNormally } from "./backend";
import { getSafeStart, safeStartReasonText, subscribeSafeStart } from "./state";

import "./safeStart.css";

/** Shown in a core safe start only. Mount once, above the canvas. */
export const SafeStartBanner = ({
  onRestartNormally = () => void restartNormally(),
  onOpenConfig = () => void openConfigDir(),
}: {
  onRestartNormally?: () => void;
  onOpenConfig?: () => void;
}) => {
  const safe = useSyncExternalStore(subscribeSafeStart, getSafeStart);
  if (safe?.scope !== "core") {
    return null;
  }
  return (
    <div
      className="vd-banner vd-banner--warning vd-safe-start"
      role="status"
      data-testid="safe-start-banner"
    >
      <span className="vd-banner__text">
        Safe start ({safeStartReasonText(safe)}). Built-in extensions and
        plugins are off.
      </span>
      <button
        type="button"
        className="vault-btn vault-btn--ghost"
        onClick={onRestartNormally}
      >
        Restart normally
      </button>
      <button
        type="button"
        className="vault-btn vault-btn--ghost"
        onClick={onOpenConfig}
      >
        Open config folder
      </button>
    </div>
  );
};
