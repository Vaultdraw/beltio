import { useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

import { isHarnessBuild, shouldShowFirstRun } from "./setupState";
import { useSetupRequested } from "./setupStore";

/** True while the setup should be on screen: first run with no vault, or asked for by the command. */
export function useSetupVisible(vaultOpen: boolean, win?: Window | null) {
  const requested = useSetupRequested();
  const prefs = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win),
    () => getPreferences(win),
  );
  const firstRun =
    !vaultOpen &&
    shouldShowFirstRun({
      completed: prefs.onboardingCompleted,
      recentVaults: prefs.recentVaults,
      lastVaultPath: prefs.lastVaultPath,
      testBuild: isHarnessBuild(),
    });
  return requested || firstRun;
}
