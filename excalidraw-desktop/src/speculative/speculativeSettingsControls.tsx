/** Control of the `files.speculative_open` row; spread into pages/index.ts. */
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

const SpeculativeOpenSetting = () => {
  const { win } = useSettings();
  const [value, setValue] = useState(
    () => getPreferences(win).filesSpeculativeOpen,
  );
  useEffect(() => {
    const refresh = () => setValue(getPreferences(win).filesSpeculativeOpen);
    refresh();
    return subscribePreferences(refresh);
  }, [win]);
  return (
    <SettingRow
      id="files-speculative-open"
      htmlFor="vault-files-speculative-open"
    >
      <Switch
        id="vault-files-speculative-open"
        checked={value}
        onChange={(next) => {
          setValue(next);
          updatePreferences({ filesSpeculativeOpen: next }, win);
        }}
      />
    </SettingRow>
  );
};

export const speculativeControls: SettingControls = {
  "files-speculative-open": { Component: SpeculativeOpenSetting },
};
