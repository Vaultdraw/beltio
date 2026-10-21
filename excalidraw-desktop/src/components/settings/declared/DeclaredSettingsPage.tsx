import { useSyncExternalStore } from "react";

import {
  allowsScope,
  effectiveSetting,
  type SettingDecl,
  type SettingScopeName,
} from "../../../plugins/settings/declaredSettings";
import { setPluginSetting } from "../../../plugins/settings/pluginSettings";
import {
  pluginSettingsDecls,
  subscribePluginSettings,
} from "../../../plugins/settings/registry";
import {
  getPreferences,
  subscribePreferences,
} from "../../../vault/preferences";
import {
  getVaultSettingsSnapshot,
  subscribeVaultSettings,
} from "../../../vault/vaultSettings";
import { Segmented, Stepper, Switch, ColorSwatches } from "../pages/controls";
import { OVERRIDDEN_NOTE } from "../scopeHelp";
import { ScopeSwitch } from "../ScopeSwitch";
import { SettingRow } from "../SettingRow";
import { useSettings } from "../SettingsContext";

import type { PluginSettingValue } from "../../../vault/pluginSettingsTable";

/** Select with few options reads better as segments (like the built-ins). */
const SEGMENT_LIMIT = 3;

const stepFor = (decl: SettingDecl) =>
  decl.type === "int" ? 1 : (decl.max ?? 1) - (decl.min ?? 0) <= 10 ? 0.1 : 1;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

interface ControlProps {
  decl: SettingDecl;
  id: string;
  value: PluginSettingValue;
  onChange: (value: PluginSettingValue) => void;
}

const DeclaredControl = ({ decl, id, value, onChange }: ControlProps) => {
  switch (decl.type) {
    case "bool":
      return (
        <Switch
          id={id}
          checked={value === true}
          label={decl.title}
          onChange={onChange}
        />
      );
    case "int":
    case "number": {
      const n = Number(value);
      return (
        <Stepper
          value={n}
          label={decl.title}
          min={decl.min ?? Math.min(0, n)}
          max={decl.max ?? Math.max(1000, n)}
          step={stepFor(decl)}
          onChange={(next) => onChange(round(next))}
        />
      );
    }
    case "select": {
      const options = decl.options ?? [];
      return options.length <= SEGMENT_LIMIT ? (
        <Segmented
          label={decl.title}
          value={String(value)}
          options={options.map((o) => ({ label: o.label, val: o.value }))}
          onChange={onChange}
        />
      ) : (
        <select
          id={id}
          className="vault-input"
          aria-label={decl.title}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "color":
      return (
        <ColorSwatches
          colors={[]}
          value={String(value)}
          customValue={
            /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"
          }
          customTitle={`Custom ${decl.title}`}
          swatchLabel={(c) => c}
          showHex
          onChange={onChange}
        />
      );
    case "string":
      return (
        <input
          id={id}
          type="text"
          className="vault-input"
          aria-label={decl.title}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
};

const DeclaredRow = ({
  pluginId,
  decl,
}: {
  pluginId: string;
  decl: SettingDecl;
}) => {
  const { win, scope } = useSettings();
  const globalRaw = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win).pluginSettings[pluginId]?.[decl.key],
  );
  const vaultRaw = useSyncExternalStore(
    subscribeVaultSettings,
    () => getVaultSettingsSnapshot().pluginOverrides[pluginId]?.[decl.key],
  );
  // A setting that cannot be per-vault always edits the global value.
  const layer =
    scope === "vault" && allowsScope(decl, "vault") ? "vault" : "global";
  const overridden = vaultRaw !== undefined && allowsScope(decl, "vault");
  const value =
    layer === "vault"
      ? effectiveSetting(decl, globalRaw, vaultRaw)
      : effectiveSetting(decl, globalRaw, undefined);
  const id = `declared-${pluginId}-${decl.key}`;
  const write = (
    next: PluginSettingValue | undefined,
    to: SettingScopeName = layer,
  ) => void setPluginSetting(pluginId, decl.key, next, to, win);

  return (
    <SettingRow
      id={id}
      label={decl.title}
      description={decl.description}
      htmlFor={id}
      testId={id}
      data={
        layer === "vault"
          ? { "data-scope-state": overridden ? "overridden" : "inherited" }
          : { "data-vault-override": overridden ? "true" : undefined }
      }
      onReset={layer === "global" ? () => write(undefined) : undefined}
      details={
        layer === "vault" ? (
          <span
            className="vault-scope-badge"
            data-overridden={overridden || undefined}
          >
            <span>{overridden ? "Overridden" : "Inherited from global"}</span>
            {overridden && (
              <button
                type="button"
                className="vault-btn vault-btn--ghost vault-btn--sm"
                aria-label={`Reset ${decl.title} to global`}
                onClick={() => write(undefined, "vault")}
              >
                Reset to global
              </button>
            )}
          </span>
        ) : (
          overridden && (
            <span className="vault-scope-note">{OVERRIDDEN_NOTE}</span>
          )
        )
      }
    >
      <DeclaredControl
        decl={decl}
        id={id}
        value={value}
        onChange={(next) => write(next)}
      />
    </SettingRow>
  );
};

/**
 * The settings a plugin declared, one row each. Plugin ids are not in the
 * built-in schema, so rows carry their own label; this page is not in the
 * sidebar until a plugin declares settings (P2).
 */
export const DeclaredSettingsPage = ({
  pluginId,
  title,
}: {
  pluginId: string;
  title: string;
}) => {
  const decls = useSyncExternalStore(subscribePluginSettings, () =>
    pluginSettingsDecls(pluginId),
  );
  return (
    <section
      className="vault-settings-section"
      aria-label={title}
      data-testid={`declared-settings-${pluginId}`}
    >
      <h3 className="vault-settings-heading">{title}</h3>
      {decls.some((d) => allowsScope(d, "vault")) && <ScopeSwitch />}
      {decls.map((decl) => (
        <DeclaredRow key={decl.key} pluginId={pluginId} decl={decl} />
      ))}
    </section>
  );
};
