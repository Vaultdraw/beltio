/**
 * Controls of the "Startup" section on the General settings page. Rows come
 * from servicesSettingsSchema.ts; spread into pages/index.ts.
 */
import { useEffect, useState } from "react";

import { Segmented } from "../components/settings/pages/controls";
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

import type { ServicesField, StartMode } from "./servicesSettings";

const OPTIONS: readonly { label: string; val: StartMode }[] = [
  { label: "On open", val: "open" },
  { label: "When idle", val: "idle" },
  { label: "On first use", val: "use" },
];

const StartSetting = ({
  id,
  field,
  label,
}: {
  id: string;
  field: ServicesField;
  label: string;
}) => {
  const { win } = useSettings();
  const [value, setValue] = useState(() => getPreferences(win)[field]);
  useEffect(() => {
    const refresh = () => setValue(getPreferences(win)[field]);
    refresh();
    return subscribePreferences(refresh);
  }, [win, field]);
  return (
    <SettingRow id={id}>
      <Segmented
        label={label}
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          updatePreferences({ [field]: next }, win);
        }}
      />
    </SettingRow>
  );
};

export const servicesControls: SettingControls = {
  "services-search-start": {
    Component: () => (
      <StartSetting
        id="services-search-start"
        field="searchStart"
        label="Start search index"
      />
    ),
  },
  "services-links-start": {
    Component: () => (
      <StartSetting
        id="services-links-start"
        field="linksStart"
        label="Start link index"
      />
    ),
  },
  "services-history-start": {
    Component: () => (
      <StartSetting
        id="services-history-start"
        field="historyStart"
        label="Start file history"
      />
    ),
  },
};
