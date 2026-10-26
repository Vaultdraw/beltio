/**
 * Controls of the "Layout" section on the Interface settings page. Rows come
 * from layoutSettingsSchema.ts; spread into pages/index.ts.
 */
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

type Field = "layoutHeader" | "layoutFooter";

const LayoutSwitch = ({ id, field }: { id: string; field: Field }) => {
  const { win } = useSettings();
  const [value, setValue] = useState(() => getPreferences(win)[field]);
  useEffect(() => {
    const refresh = () => setValue(getPreferences(win)[field]);
    refresh();
    return subscribePreferences(refresh);
  }, [win, field]);
  return (
    <SettingRow id={id} htmlFor={`vault-${id}`}>
      <Switch
        id={`vault-${id}`}
        checked={value}
        onChange={(next) => {
          setValue(next);
          updatePreferences({ [field]: next }, win);
        }}
      />
    </SettingRow>
  );
};

export const layoutControls: SettingControls = {
  "layout-header": {
    Component: () => <LayoutSwitch id="layout-header" field="layoutHeader" />,
  },
  "layout-footer": {
    Component: () => <LayoutSwitch id="layout-footer" field="layoutFooter" />,
  },
};
