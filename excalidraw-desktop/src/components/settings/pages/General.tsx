import { useState } from "react";

import {
  getSettingsStatus,
  isWarning,
  openConfigDir,
  reloadSettings,
} from "../../../vault/settingsSync";
import { IconFolder, IconRefresh } from "../../Icons";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const ConfigFileSetting = () => {
  const { settingsStatus, setSettingsStatus } = useSettings();
  const [action, setAction] = useState<{
    message: string;
    type: "info" | "warning" | "error";
  } | null>(null);

  const handleOpen = async () => {
    setAction(null);
    try {
      await openConfigDir();
    } catch (err) {
      setAction({
        message: `Could not open the config folder: ${errorText(err)}`,
        type: "error",
      });
    }
  };

  const handleReload = async () => {
    setAction(null);
    try {
      const changed = await reloadSettings();
      const status = getSettingsStatus();
      setSettingsStatus(status);
      const errors = status.problems.filter((p) => !isWarning(p)).length;
      const warnings = status.problems.length - errors;
      const count = (n: number, what: string) =>
        `${n} ${what}${n === 1 ? "" : "s"}`;
      setAction(
        errors
          ? {
              message: `Reloaded with ${count(errors, "error")}${
                warnings ? ` and ${count(warnings, "warning")}` : ""
              } (listed above).`,
              type: "error",
            }
          : warnings
          ? {
              message: `Reloaded config.toml with ${count(
                warnings,
                "warning",
              )} (listed above).`,
              type: "warning",
            }
          : {
              message: changed
                ? "Reloaded config.toml."
                : "config.toml is up to date.",
              type: "info",
            },
      );
    } catch (err) {
      setAction({
        message: `Could not reload: ${errorText(err)}`,
        type: "error",
      });
    }
  };

  if (settingsStatus.mode !== "tauri") {
    return (
      <SettingRow
        id="config-file"
        testId="settings-config-note"
        description="Settings are saved in this browser. The desktop app keeps them in a plain config.toml you can edit by hand."
      />
    );
  }

  return (
    <SettingRow
      id="config-file"
      className="vault-config-row"
      testId="settings-config-row"
      details={
        <>
          <code className="vault-config-path">
            {settingsStatus.configPath ?? "Unknown location"}
          </code>
          {settingsStatus.overridesPath && (
            <code
              className="vault-config-path"
              title="Settings saves your changes here; it wins over config.toml. Safe to delete."
            >
              {settingsStatus.overridesPath}
            </code>
          )}
          {settingsStatus.problems.length > 0 && (
            <ul
              className="vault-config-problems"
              aria-label="Problems in config files"
            >
              {settingsStatus.problems.map((problem) => (
                <li
                  key={problem.message}
                  className={
                    isWarning(problem)
                      ? "vault-config-problem--warning"
                      : "vault-config-problem--error"
                  }
                >
                  {problem.message}
                </li>
              ))}
            </ul>
          )}
          {action && (
            <div
              className={`vault-config-status vault-config-status--${action.type}`}
              role="status"
            >
              {action.message}
            </div>
          )}
        </>
      }
    >
      <div className="vault-config-actions">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void handleOpen()}
        >
          <IconFolder />
          <span>Open config folder</span>
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void handleReload()}
        >
          <IconRefresh />
          <span>Reload</span>
        </button>
      </div>
    </SettingRow>
  );
};

export const generalControls: SettingControls = {
  "config-file": {
    Component: ConfigFileSetting,
    // In the browser the row is only a note about where settings live.
    searchable: (ctx) => ctx.settingsStatus.mode === "tauri",
  },
};
