/**
 * Controls of the "Memory" section on the Interface settings page. Rows come
 * from memorySettingsSchema.ts; spread into pages/index.ts.
 */
import { useEffect, useState } from "react";

import { Stepper, Switch } from "../components/settings/pages/controls";
import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
  type PreferencesSnapshot,
  type VaultPreferences,
} from "../vault/preferences";

import { MEMORY_UNDO_STEPS, type MemoryField } from "./memorySettings";

/** A global (not per-vault) memory preference, kept in sync with config.toml. */
const useMemoryPref = <F extends MemoryField>(
  field: F,
): [PreferencesSnapshot[F], (value: PreferencesSnapshot[F]) => void] => {
  const { win } = useSettings();
  const [value, setValue] = useState(() => getPreferences(win)[field]);
  useEffect(() => {
    const refresh = () => setValue(getPreferences(win)[field]);
    refresh();
    return subscribePreferences(refresh);
  }, [win, field]);
  return [
    value,
    (next) => {
      setValue(next);
      updatePreferences({ [field]: next } as Partial<VaultPreferences>, win);
    },
  ];
};

const FreeImagesSetting = () => {
  const [value, set] = useMemoryPref("memoryFreeUnusedImages");
  return (
    <SettingRow
      id="memory-free-unused-images"
      htmlFor="vault-memory-free-unused-images"
    >
      <Switch
        id="vault-memory-free-unused-images"
        checked={value}
        onChange={set}
      />
    </SettingRow>
  );
};

const UndoStepsSetting = () => {
  const [value, set] = useMemoryPref("memoryUndoSteps");
  return (
    <SettingRow id="memory-undo-steps">
      <Stepper
        label="Undo steps kept per drawing"
        {...MEMORY_UNDO_STEPS}
        value={value}
        onChange={set}
      />
    </SettingRow>
  );
};

export const memoryControls: SettingControls = {
  "memory-free-unused-images": { Component: FreeImagesSetting },
  "memory-undo-steps": { Component: UndoStepsSetting },
};
