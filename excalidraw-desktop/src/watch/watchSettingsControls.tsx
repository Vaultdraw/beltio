/** Control of the `files.auto_reload` row; spread into pages/index.ts. */
import { useEffect, useState } from "react";

import { Switch } from "../components/settings/pages/controls";
import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

const AutoReloadSetting = () => {
  const { win } = useSettings();
  const [value, setValue] = useState(() => getPreferences(win).filesAutoReload);
  useEffect(() => {
    const refresh = () => setValue(getPreferences(win).filesAutoReload);
    refresh();
    return subscribePreferences(refresh);
  }, [win]);
  return (
    <SettingRow id="files-auto-reload" htmlFor="vault-files-auto-reload">
      <Switch
        id="vault-files-auto-reload"
        checked={value}
        onChange={(next) => {
          setValue(next);
          updatePreferences({ filesAutoReload: next }, win);
        }}
      />
    </SettingRow>
  );
};

export const watchControls: SettingControls = {
  "files-auto-reload": { Component: AutoReloadSetting },
};
