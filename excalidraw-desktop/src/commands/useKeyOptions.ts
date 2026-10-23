import { useEffect, useRef, useState } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

import { toKeySettings, type KeySettings } from "./keySettings";

/** `[keys]` options kept in sync with the preferences store (live reload). */
export function useKeyOptions(win: Window | null): KeySettings {
  const [settings, setSettings] = useState<KeySettings>(() =>
    toKeySettings(getPreferences(win)),
  );
  const lastJson = useRef(JSON.stringify(settings));
  useEffect(() => {
    const sync = () => {
      const next = toKeySettings(getPreferences(win));
      const json = JSON.stringify(next);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setSettings(next);
      }
    };
    sync();
    return subscribePreferences(sync);
  }, [win]);
  return settings;
}
