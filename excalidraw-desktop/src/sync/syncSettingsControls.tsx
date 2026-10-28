/**
 * Controls of the "Sync services" section on the Interface settings page. Rows come from
 * syncSettingsSchema.ts; spread into pages/index.ts.
 */
import { Switch } from "../components/settings/pages/controls";
import { SettingRow } from "../components/settings/SettingRow";
import {
  useSettings,
  type SettingControls,
} from "../components/settings/SettingsContext";
import { useGlobalPref } from "../vault/useGlobalPref";

import type { SyncField } from "./syncSettings";

const SyncSwitch = ({ id, field }: { id: string; field: SyncField }) => {
  const { win } = useSettings();
  const [value, set] = useGlobalPref(win, field);
  return (
    <SettingRow id={id} htmlFor={`vault-${id}`}>
      <Switch id={`vault-${id}`} checked={value} onChange={set} />
    </SettingRow>
  );
};

export const syncControls: SettingControls = {
  "sync-conflict-badge": {
    Component: () => (
      <SyncSwitch id="sync-conflict-badge" field="syncConflictBadge" />
    ),
  },
  "sync-download-placeholders": {
    Component: () => (
      <SyncSwitch
        id="sync-download-placeholders"
        field="syncDownloadPlaceholders"
      />
    ),
  },
};
