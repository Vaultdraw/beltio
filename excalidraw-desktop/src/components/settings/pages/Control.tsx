import { useSyncExternalStore } from "react";

import { requestAiOn, setAiOff } from "../../../ai/aiSwitch";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Switch } from "./controls";

const usePref = <K extends "aiEnabled" | "aiMcpEnabled" | "controlNotifyEdits">(
  win: Window | null,
  key: K,
) => useSyncExternalStore(subscribePreferences, () => getPreferences(win)[key]);

const AiSetting = () => {
  const { win } = useSettings();
  const on = usePref(win, "aiEnabled");
  return (
    <SettingRow
      id="ai-enabled"
      htmlFor="vault-ai-enabled"
      testId="setting-ai-enabled"
    >
      <Switch
        id="vault-ai-enabled"
        checked={on}
        onChange={(next) => (next ? requestAiOn(win) : setAiOff(win))}
      />
    </SettingRow>
  );
};

const McpSetting = () => {
  const { win } = useSettings();
  const aiOn = usePref(win, "aiEnabled");
  const on = usePref(win, "aiMcpEnabled");
  if (!aiOn) {
    return null;
  }
  return (
    <SettingRow
      id="ai-mcp-enabled"
      testId="setting-ai-mcp-enabled"
      htmlFor="vault-ai-mcp-enabled"
      className="vault-setting-row--sub"
    >
      <Switch
        id="vault-ai-mcp-enabled"
        checked={on}
        onChange={(next) => updatePreferences({ aiMcpEnabled: next }, win)}
      />
    </SettingRow>
  );
};

const NotifyEditsSetting = () => {
  const { win } = useSettings();
  const on = usePref(win, "controlNotifyEdits");
  return (
    <SettingRow id="control-notify-edits" htmlFor="vault-control-notify-edits">
      <Switch
        id="vault-control-notify-edits"
        checked={on}
        onChange={(next) =>
          updatePreferences({ controlNotifyEdits: next }, win)
        }
      />
    </SettingRow>
  );
};

export const controlControls: SettingControls = {
  "ai-enabled": { Component: AiSetting },
  // A sub-switch: renders nothing while AI is off.
  "ai-mcp-enabled": { Component: McpSetting },
  "control-notify-edits": { Component: NotifyEditsSetting },
};
