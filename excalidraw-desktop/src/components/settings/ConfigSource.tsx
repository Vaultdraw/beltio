import { useState, type ReactNode } from "react";

import { keySource, type KeySource } from "../../vault/configSources";
import {
  openConfigFile,
  resetConfigKey,
  type SettingsStatus,
} from "../../vault/settingsSync";

import { useSettingsOptional } from "./SettingsContext";

const show = (value: unknown) =>
  typeof value === "string" ? `"${value}"` : JSON.stringify(value);

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Where a row's value comes from, computed from the layers already loaded. `null`
 * in the browser, outside Settings, and while the value is the built-in default.
 */
export const useConfigSource = (
  configKey: string | undefined,
): (KeySource & { key: string }) | null => {
  const settings = useSettingsOptional();
  const status: SettingsStatus | undefined = settings?.settingsStatus;
  if (!configKey || !status || status.mode !== "tauri") {
    return null;
  }
  const found = keySource(status.layers, configKey);
  return found.source === "default" ? null : { ...found, key: configKey };
};

/** The small label beside a row's title: `config.toml` or `overrides`. Click for details. */
export const ConfigSourceChip = ({
  source,
  open,
  onToggle,
}: {
  source: KeySource;
  open: boolean;
  onToggle: () => void;
}) => {
  const fromOverrides = source.source === "overrides.toml";
  return (
    <button
      type="button"
      className="vault-source-chip"
      data-source={fromOverrides ? "overrides" : "config"}
      data-hides={source.hidden ? "true" : undefined}
      aria-expanded={open}
      aria-label={`Value from ${source.source}${
        source.hidden ? `, hides ${source.hidden.file}` : ""
      }`}
      onClick={onToggle}
    >
      {fromOverrides ? "overrides" : "config.toml"}
      {source.hidden && <span aria-hidden="true"> ≠</span>}
    </button>
  );
};

/** What the chip means, with the actions that undo it. Plain words, keyboard operable. */
export const ConfigSourceNote = ({
  source,
}: {
  source: KeySource & { key: string };
}) => {
  const [error, setError] = useState<string | null>(null);
  const run = (task: () => Promise<void>) => {
    setError(null);
    task().catch((err) => setError(errorText(err)));
  };
  const fromOverrides = source.source === "overrides.toml";
  let text: ReactNode;
  const actions: ReactNode[] = [];
  const button = (label: string, task: () => Promise<void>) => (
    <button
      key={label}
      type="button"
      className="vault-btn vault-btn--sm"
      onClick={() => run(task)}
    >
      {label}
    </button>
  );
  if (fromOverrides) {
    text = source.hidden ? (
      <>
        Set in overrides.toml (what you changed in Settings).{" "}
        <code>{source.hidden.file}</code> says{" "}
        <code>{show(source.hidden.value)}</code>.
      </>
    ) : (
      <>Set in overrides.toml (what you changed in Settings).</>
    );
    actions.push(
      source.hidden
        ? button("Reset to config.toml value", () => resetConfigKey(source.key))
        : button("Reset to default", () => resetConfigKey(source.key)),
    );
  } else {
    text = (
      <>
        Set in config.toml. Edit that file to change it; a change made here is
        saved apart and wins over it.
      </>
    );
    actions.push(button("Use default", () => resetConfigKey(source.key, true)));
  }
  actions.push(button("Open config.toml", () => openConfigFile()));
  return (
    <div className="vault-source-note" role="group" aria-label="Value source">
      <span>{text}</span>
      <span className="vault-source-note__actions">{actions}</span>
      {error && (
        <span className="vault-config-status--error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
};
