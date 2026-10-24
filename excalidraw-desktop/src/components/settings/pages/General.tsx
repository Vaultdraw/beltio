import { useState } from "react";

import {
  requestResetOverrides,
  runConfigCheck,
} from "../../../commands/configCommands";
import { layerFileName } from "../../../vault/configSources";
import {
  getSettingsStatus,
  isWarning,
  openConfigDir,
  openConfigFile,
  openIncludedFile,
  reloadSettings,
  revealOverrides,
  type LayerPayload,
} from "../../../vault/settingsSync";
import { IconFolder, IconRefresh } from "../../Icons";
import { useSettings, type SettingControls } from "../SettingsContext";
import { SettingRow } from "../SettingRow";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** One line per config layer: name, path, status, and a button to open it. */
const LayerList = ({
  layers,
  onOpen,
}: {
  layers: readonly LayerPayload[];
  onOpen: (layer: LayerPayload) => void;
}) => (
  <ul className="vault-config-layers" aria-label="Config files">
    {layers.map((layer) => {
      const overrides = layer.kind === "overrides";
      const included = layer.kind === "include";
      const fileName = layerFileName(layer);
      const status =
        layer.status === "error"
          ? "skipped, has an error"
          : layer.status === "missing"
          ? included
            ? "not found"
            : overrides
            ? "not created yet (no Settings changes)"
            : "missing"
          : "loaded";
      return (
        <li key={layer.id} className="vault-config-layer">
          <span>
            <span className="vault-config-layer__name">{fileName}</span>{" "}
            <span
              className="vault-config-layer__status"
              data-status={layer.status}
            >
              {overrides
                ? "Settings changes, wins"
                : included
                ? `included by ${
                    layer.from?.split(/[\\/]/).pop() ?? "config.toml"
                  }`
                : "yours, never edited"}
              {" · "}
              {status}
            </span>
            <code className="vault-config-path" title={layer.path}>
              {layer.path}
            </code>
          </span>
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={() => onOpen(layer)}
            aria-label={`Open ${fileName}`}
            disabled={included && layer.status === "missing"}
          >
            Open
          </button>
        </li>
      );
    })}
  </ul>
);

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

  const handleOpenLayer = async (layer: LayerPayload) => {
    setAction(null);
    try {
      await (layer.kind === "overrides"
        ? revealOverrides()
        : layer.kind === "include"
        ? openIncludedFile(layer.path)
        : openConfigFile());
    } catch (err) {
      setAction({
        message: `Could not open ${layer.path}: ${errorText(err)}`,
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
              message: `Reloaded the config files with ${count(
                warnings,
                "warning",
              )} (listed above).`,
              type: "warning",
            }
          : {
              message: changed
                ? "Reloaded the config files."
                : "The config files are up to date.",
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
          {settingsStatus.layers?.length ? (
            <LayerList
              layers={settingsStatus.layers}
              onOpen={(layer) => void handleOpenLayer(layer)}
            />
          ) : (
            <code className="vault-config-path">
              {settingsStatus.configPath ?? "Unknown location"}
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
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          title="Check the config files for unknown keys and invalid values, with line numbers"
          onClick={() => void runConfigCheck()}
        >
          <span>Check</span>
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          title="Delete overrides.toml: values go back to config.toml or the defaults"
          onClick={requestResetOverrides}
        >
          <span>Reset all Settings changes</span>
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
