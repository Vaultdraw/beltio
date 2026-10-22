import { useMemo, useSyncExternalStore } from "react";

import { subscribePreferences } from "../../vault/preferences";
import { subscribeVaultSettings } from "../../vault/vaultSettings";

import { allPluginSettingProblems } from "./pluginSettings";
import { subscribePluginSettings } from "./registry";

const subscribeAll = (cb: () => void) => {
  const offs = [
    subscribePreferences(cb),
    subscribeVaultSettings(cb),
    subscribePluginSettings(cb),
  ];
  return () => offs.forEach((off) => off());
};

/** Messages of stored plugin setting values that fail their declaration. */
export function usePluginSettingProblems(win?: Window | null): string[] {
  // A joined string keeps the snapshot comparable between renders.
  const joined = useSyncExternalStore(subscribeAll, () =>
    allPluginSettingProblems(win)
      .map((p) => p.message)
      .join("\n"),
  );
  return useMemo(() => (joined ? joined.split("\n") : []), [joined]);
}
