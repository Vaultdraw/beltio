import { SettingRow } from "../SettingRow";
import { getSettingSchema } from "../schema";
import { OVERRIDDEN_NOTE } from "../scopeHelp";
import { useSettings } from "../SettingsContext";

import type { ReactNode } from "react";

import type { VaultPreferences } from "../../../vault/preferences";
import type {
  EffectiveVaultSettings,
  VaultField,
} from "../../../vault/vaultSettings";

/**
 * Data attributes that describe how `field` relates to the vault:
 * `data-scope-state` (vault scope: "inherited" | "overridden") and
 * `data-vault-override` (global scope: the open vault overrides it).
 */
export const useScopeAttrs = (
  field: VaultField,
): Record<`data-${string}`, string | undefined> => {
  const { scope, vaultSettings } = useSettings();
  const overridden = vaultSettings.isOverridden(field);
  return scope === "vault"
    ? { "data-scope-state": overridden ? "overridden" : "inherited" }
    : { "data-vault-override": overridden ? "true" : undefined };
};

/**
 * Vault scope: "Inherited from global", or "Overridden" with a "Reset to
 * global" button. Global scope: a note when the open vault overrides it.
 */
export const ScopeBadge = ({
  field,
  resetLabel,
  alsoReset = [],
}: {
  field: VaultField;
  /** Fields stored together with `field`: reset with it. */
  alsoReset?: readonly VaultField[];
  /** Accessible name of the reset button, e.g. "Reset Arrow to global". */
  resetLabel: string;
}) => {
  const { scope, vaultSettings, resetToGlobal } = useSettings();
  const overridden = vaultSettings.isOverridden(field);
  if (scope === "global") {
    return overridden ? (
      <span className="vault-scope-note">{OVERRIDDEN_NOTE}</span>
    ) : null;
  }
  return (
    <span
      className="vault-scope-badge"
      data-overridden={overridden || undefined}
    >
      <span>{overridden ? "Overridden" : "Inherited from global"}</span>
      {overridden && (
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          aria-label={resetLabel}
          onClick={() => [field, ...alsoReset].forEach(resetToGlobal)}
        >
          Reset to global
        </button>
      )}
    </span>
  );
};

/** Errors writing the vault's settings file (shown under scoped rows). */
export const ScopeErrors = () => {
  const { vaultSettings } = useSettings();
  return (
    <>
      {vaultSettings.problems
        .filter((p) => p.kind === "io")
        .map((p) => (
          <div
            key={p.message}
            className="vault-config-status vault-config-status--error"
            role="status"
          >
            {p.message}
          </div>
        ))}
    </>
  );
};

/**
 * Props that make a plain SettingRow show its vault scope (badge, inherited
 * style, write errors), for rows whose control is not a ScopedRow child.
 */
export const useScopedRowProps = (
  id: string,
  field: VaultField,
  details?: ReactNode,
) => {
  const attrs = useScopeAttrs(field);
  return {
    data: attrs,
    className:
      attrs["data-scope-state"] === "inherited"
        ? "vault-setting-row--inherited"
        : undefined,
    details: (
      <>
        {details}
        <ScopeBadge
          field={field}
          resetLabel={`Reset ${getSettingSchema(id).label} to global`}
        />
        <ScopeErrors />
      </>
    ),
  };
};

/**
 * A row whose value can be stored per vault. It shows and edits the value of
 * the current scope (global config, or the vault's override); the Settings
 * header owns the scope switch.
 */
export const ScopedRow = <F extends VaultField>({
  id,
  field,
  children,
  details,
  below,
  description,
  onReset,
  layout,
  testId,
  alsoReset,
}: {
  id: string;
  field: F;
  children: (
    value: EffectiveVaultSettings[F],
    onChange: (value: VaultPreferences[F]) => void,
  ) => ReactNode;
  details?: ReactNode;
  /** Full-width block under the row. */
  below?: ReactNode;
  description?: ReactNode;
  /** Restore the default (offered in global scope only). */
  onReset?: () => void;
  layout?: "row" | "block" | "stacked";
  testId?: string;
  /** Other fields saved with `field`: "Reset to global" resets them too. */
  alsoReset?: readonly VaultField[];
}) => {
  const { scope, scopedValue, setScopedValue } = useSettings();
  const attrs = useScopeAttrs(field);
  return (
    <SettingRow
      id={id}
      description={description}
      onReset={scope === "global" ? onReset : undefined}
      layout={layout}
      below={below}
      testId={testId}
      data={attrs}
      className={
        attrs["data-scope-state"] === "inherited"
          ? "vault-setting-row--inherited"
          : undefined
      }
      details={
        <>
          {details}
          <ScopeBadge
            field={field}
            alsoReset={alsoReset}
            resetLabel={`Reset ${getSettingSchema(id).label} to global`}
          />
          <ScopeErrors />
        </>
      }
    >
      {children(scopedValue(field), (value) => setScopedValue(field, value))}
    </SettingRow>
  );
};
