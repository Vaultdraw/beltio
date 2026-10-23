/**
 * Controls of the "Tabs" section on the Interface settings page. Rows come
 * from tabsSettingsSchema.ts; spread into pages/index.ts.
 */
import {
  Segmented,
  Stepper,
  Switch,
} from "../components/settings/pages/controls";
import { ScopedRow } from "../components/settings/pages/scopedRow";
import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import { useGlobalPref } from "../vault/useGlobalPref";

import { TABS_UNDO_BUDGET_MB, type TabsField } from "./tabsSettings";

import type { VaultPreferences } from "../vault/preferences";

/** A global (not per-vault) tabs preference, kept in sync with config.toml. */
const useTabsPref = <F extends TabsField>(field: F) =>
  useGlobalPref(useSettings().win, field);

const SwitchSetting = ({
  id,
  field,
}: {
  id: string;
  field: "tabsEnabled" | "tabsFocusNew" | "tabsClosePinned";
}) => {
  const [value, set] = useTabsPref(field);
  return (
    <SettingRow id={id} htmlFor={`vault-${id}`}>
      <Switch id={`vault-${id}`} checked={value} onChange={set} />
    </SettingRow>
  );
};

const ChoiceSetting = <
  F extends "tabsShowStrip" | "tabsNewTabPosition" | "tabsCtrlTab",
>({
  id,
  field,
  label,
  options,
}: {
  id: string;
  field: F;
  label: string;
  options: readonly { label: string; val: VaultPreferences[F] & string }[];
}) => {
  const [value, set] = useTabsPref(field);
  return (
    <SettingRow id={id}>
      <Segmented
        label={label}
        options={options}
        value={value as VaultPreferences[F] & string}
        onChange={set}
      />
    </SettingRow>
  );
};

const UndoBudgetSetting = () => {
  const [value, set] = useTabsPref("tabsUndoBudgetMb");
  return (
    <SettingRow id="tabs-undo-budget">
      <Stepper
        label="Undo history for background tabs"
        unit="MB"
        min={TABS_UNDO_BUDGET_MB.min}
        max={TABS_UNDO_BUDGET_MB.max}
        step={8}
        value={value}
        onChange={set}
      />
    </SettingRow>
  );
};

export const tabsControls: SettingControls = {
  "tabs-enabled": {
    Component: () => <SwitchSetting id="tabs-enabled" field="tabsEnabled" />,
  },
  "tabs-show-strip": {
    Component: () => (
      <ChoiceSetting
        id="tabs-show-strip"
        field="tabsShowStrip"
        label="Show tab strip"
        options={[
          { label: "Always", val: "always" },
          { label: "Never", val: "never" },
        ]}
      />
    ),
  },
  "tabs-open-from-navigator": {
    Component: () => (
      <ScopedRow id="tabs-open-from-navigator" field="tabsOpenFromNavigator">
        {(value, onChange) => (
          <Segmented
            label="Open drawings from the file tree in"
            options={[
              { label: "Current tab", val: "current" },
              { label: "New tab", val: "new" },
            ]}
            value={value}
            onChange={onChange}
          />
        )}
      </ScopedRow>
    ),
  },
  "tabs-focus-new": {
    Component: () => <SwitchSetting id="tabs-focus-new" field="tabsFocusNew" />,
  },
  "tabs-new-tab-position": {
    Component: () => (
      <ChoiceSetting
        id="tabs-new-tab-position"
        field="tabsNewTabPosition"
        label="New tabs open"
        options={[
          { label: "After the active tab", val: "after_active" },
          { label: "At the end", val: "end" },
        ]}
      />
    ),
  },
  "tabs-ctrl-tab": {
    Component: () => (
      <ChoiceSetting
        id="tabs-ctrl-tab"
        field="tabsCtrlTab"
        label="Ctrl+Tab goes to"
        options={[
          { label: "Last used tab", val: "mru" },
          { label: "Next tab in the strip", val: "order" },
        ]}
      />
    ),
  },
  "tabs-close-pinned": {
    Component: () => (
      <SwitchSetting id="tabs-close-pinned" field="tabsClosePinned" />
    ),
  },
  "tabs-restore": {
    Component: () => (
      <ScopedRow id="tabs-restore" field="tabsRestore">
        {(value, onChange) => (
          <Switch
            id="vault-tabs-restore"
            checked={value}
            label="Restore open tabs when a vault opens"
            onChange={onChange}
          />
        )}
      </ScopedRow>
    ),
  },
  "tabs-undo-budget": { Component: UndoBudgetSetting },
};
