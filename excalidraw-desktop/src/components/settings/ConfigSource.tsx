import { useState, type ReactNode } from "react";

import { keySource, type KeySource } from "../../vault/configSources";
import {
  openConfigFile,
  openIncludedFile,
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

/**
 * The small label beside a row's title: "Changed" (set in Settings) or "From
 * file" (set by hand in the config file). The file name lives in the tooltip
 * and the note, never in the chip (Zed: "Set in settings.json", one link).
 */
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
  const label = fromOverrides ? "Changed" : "From file";
  const title = fromOverrides
    ? source.hidden
      ? `Changed here; ${source.hidden.file} says ${show(source.hidden.value)}`
      : "Changed here in Settings"
    : `Set in ${source.source}`;
  return (
    <button
      type="button"
      className="vault-source-chip"
      data-source={
        fromOverrides
          ? "overrides"
          : source.source === "config.toml"
          ? "config"
          : "include"
      }
      data-hides={source.hidden ? "true" : undefined}
      aria-expanded={open}
      title={title}
      aria-label={`Value from ${source.source}${
        source.hidden ? `, hides ${source.hidden.file}` : ""
      }`}
      onClick={onToggle}
    >
      {label}
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
        Changed in Settings. <code>{source.hidden.file}</code> says{" "}
        <code>{show(source.hidden.value)}</code>.
      </>
    ) : (
      <>Changed in Settings.</>
    );
    actions.push(
      source.hidden
        ? button("Use config file value", () => resetConfigKey(source.key))
        : button("Reset to default", () => resetConfigKey(source.key)),
    );
  } else {
    const file = source.source;
    text = (
      <>
        Set in <code>{file}</code>. Edit that file to change it; a change made
        here is saved apart and wins over it.
      </>
    );
    actions.push(
      button("Restore default", () => resetConfigKey(source.key, true)),
    );
  }
  actions.push(
    fromOverrides || source.source === "config.toml"
      ? button("Open config file", () => openConfigFile())
      : button(`Open ${source.source}`, () =>
          openIncludedFile(source.path ?? source.source),
        ),
  );
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
