import { updatePreferences } from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { usePreference } from "../usePreference";

import { Switch } from "./controls";

import type { SettingControls } from "../SettingsContext";

const NetworkEnabledSetting = () => {
  const enabled = usePreference("networkEnabled");
  return (
    <SettingRow id="network-enabled" htmlFor="vault-network-enabled">
      <Switch
        id="vault-network-enabled"
        checked={enabled}
        onChange={(next) => updatePreferences({ networkEnabled: next })}
      />
    </SettingRow>
  );
};

const NetworkThemesSetting = () => {
  const enabled = usePreference("networkEnabled");
  const allowed = usePreference("networkAllowThemes");
  return (
    <SettingRow
      id="network-themes"
      htmlFor="vault-network-themes"
      disabled={!enabled}
      description={
        allowed === undefined
          ? "Not asked yet: the first theme install will ask."
          : undefined
      }
      onReset={
        allowed === undefined
          ? undefined
          : () => updatePreferences({ networkAllowThemes: undefined })
      }
    >
      <Switch
        id="vault-network-themes"
        checked={allowed === true}
        disabled={!enabled}
        onChange={(next) => updatePreferences({ networkAllowThemes: next })}
      />
    </SettingRow>
  );
};

export const networkControls: SettingControls = {
  "network-enabled": { Component: NetworkEnabledSetting },
  "network-themes": { Component: NetworkThemesSetting },
};
