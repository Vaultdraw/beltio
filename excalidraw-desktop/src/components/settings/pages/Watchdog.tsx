import { useSyncExternalStore } from "react";

import { detectPlatform } from "../../../commands/keys";

import {
  DEFAULT_PREFERENCES,
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../../vault/preferences";
import { WATCHDOG_LIMITS } from "../../../watchdog/limits";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Stepper, Switch } from "./controls";

const usePref = <K extends "watchdogEnabled" | "watchdogGraceMs">(
  win: Window | null,
  key: K,
) => useSyncExternalStore(subscribePreferences, () => getPreferences(win)[key]);

const EnabledSetting = () => {
  const { win } = useSettings();
  const on = usePref(win, "watchdogEnabled");
  return (
    <SettingRow
      id="watchdog-enabled"
      htmlFor="vault-watchdog-enabled"
      testId="setting-watchdog-enabled"
    >
      <Switch
        id="vault-watchdog-enabled"
        checked={on}
        onChange={(next) => updatePreferences({ watchdogEnabled: next }, win)}
      />
    </SettingRow>
  );
};

const GraceSetting = () => {
  const { win } = useSettings();
  const value = usePref(win, "watchdogGraceMs");
  const fallback = DEFAULT_PREFERENCES.watchdogGraceMs;
  return (
    <SettingRow
      id="watchdog-grace"
      onReset={
        value === fallback
          ? undefined
          : () => updatePreferences({ watchdogGraceMs: fallback }, win)
      }
    >
      <Stepper
        label="Hang watchdog delay"
        unit="ms"
        {...WATCHDOG_LIMITS.graceMs}
        step={1000}
        value={value}
        onChange={(next) => updatePreferences({ watchdogGraceMs: next }, win)}
      />
    </SettingRow>
  );
};

// The watchdog runs on macOS only (src-tauri/src/watchdog): elsewhere its rows would be switches
// that do nothing (toimprove 307).
const onMac = ({ win }: { win: Window | null }) =>
  detectPlatform(win) === "mac";

export const watchdogControls: SettingControls = {
  "watchdog-enabled": { Component: EnabledSetting, available: onMac },
  "watchdog-grace": { Component: GraceSetting, available: onMac },
};
