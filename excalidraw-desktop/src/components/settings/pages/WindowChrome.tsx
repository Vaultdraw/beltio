import { useSyncExternalStore } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Segmented } from "./controls";

import type { WindowDecorations } from "../../../vault/windowChrome";

const OPTIONS: readonly { label: string; val: WindowDecorations }[] = [
  { label: "Custom", val: "custom" },
  { label: "Native", val: "native" },
];

const DecorationsSetting = () => {
  const { win } = useSettings();
  const value = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win).windowDecorations,
  );
  return (
    <SettingRow id="window-decorations">
      <Segmented
        label="Window title bar"
        options={OPTIONS}
        value={value}
        onChange={(next) => updatePreferences({ windowDecorations: next }, win)}
      />
    </SettingRow>
  );
};

export const windowChromeControls: SettingControls = {
  "window-decorations": { Component: DecorationsSetting },
};
