import { useSyncExternalStore } from "react";

import { setOfflineMode } from "../network/offlineMode";
import {
  getPreferences,
  isOffline,
  subscribePreferences,
} from "../vault/preferences";

/** Header chip shown only while Offline mode is on; a click turns it off. */
export const OfflineBadge = ({ win = window }: { win?: Window }) => {
  const offline = useSyncExternalStore(
    subscribePreferences,
    () => isOffline(getPreferences(win)),
    () => false,
  );
  if (!offline) {
    return null;
  }
  return (
    <button
      type="button"
      className="vault-badge vault-badge--offline"
      data-testid="offline-badge"
      title="Offline mode is on: no internet features. Click to turn it off."
      onClick={() => setOfflineMode(false, win)}
    >
      Offline
    </button>
  );
};
