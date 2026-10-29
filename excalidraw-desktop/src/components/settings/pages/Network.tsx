import { isOffline, updatePreferences } from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { usePreference } from "../usePreference";

import { Switch } from "./controls";

import type { SettingControls } from "../SettingsContext";

/** Offline mode. Turning it off also clears the old master switch (`network.enabled`). */
const NetworkOfflineSetting = () => {
  const offline = usePreference("networkOffline");
  const oldSwitchOff = !usePreference("networkEnabled");
  return (
    <SettingRow id="network-offline" htmlFor="vault-network-offline">
      <Switch
        id="vault-network-offline"
        checked={isOffline({
          networkOffline: offline,
          networkEnabled: !oldSwitchOff,
        })}
        onChange={(next) =>
          updatePreferences({ networkOffline: next, networkEnabled: true })
        }
      />
    </SettingRow>
  );
};

const NetworkUpdatesSetting = () => {
  const check = usePreference("updatesCheckOnStartup");
  const offline = usePreference("networkOffline");
  const oldSwitchOff = !usePreference("networkEnabled");
  const off = offline || oldSwitchOff;
  return (
    <SettingRow
      id="network-updates"
      htmlFor="vault-network-updates"
      disabled={off}
      description={
        off ? "Offline mode is on, so nothing is checked." : undefined
      }
    >
      <Switch
        id="vault-network-updates"
        checked={check}
        disabled={off}
        onChange={(next) => updatePreferences({ updatesCheckOnStartup: next })}
      />
    </SettingRow>
  );
};

/** One download switch: on unless the user turned it off. */
const downloadSetting = (
  id: string,
  field: "networkAllowThemes" | "networkAllowPlugins",
) =>
  function DownloadSetting() {
    const allowed = usePreference(field);
    const offline = usePreference("networkOffline");
    const oldSwitchOff = !usePreference("networkEnabled");
    const off = offline || oldSwitchOff;
    return (
      <SettingRow
        id={id}
        htmlFor={`vault-${id}`}
        disabled={off}
        description={off ? "Offline mode is on." : undefined}
        onReset={
          allowed === undefined
            ? undefined
            : () => updatePreferences({ [field]: undefined })
        }
      >
        <Switch
          id={`vault-${id}`}
          checked={allowed !== false}
          disabled={off}
          onChange={(next) => updatePreferences({ [field]: next })}
        />
      </SettingRow>
    );
  };

export const networkControls: SettingControls = {
  "network-offline": { Component: NetworkOfflineSetting },
  "network-updates": { Component: NetworkUpdatesSetting },
  "network-themes": {
    Component: downloadSetting("network-themes", "networkAllowThemes"),
  },
  "network-plugins": {
    Component: downloadSetting("network-plugins", "networkAllowPlugins"),
  },
};
