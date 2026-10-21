import { IconRefresh } from "../Icons";

import { getSettingSchema } from "./schema";

import type { ReactNode } from "react";

export interface SettingRowProps {
  /** Schema id; label and default description come from schema.ts. */
  id: string;
  /** Declared (plugin) settings have no schema entry: they bring their label. */
  label?: string;
  /** Replaces the schema description (e.g. a dynamic one). */
  description?: ReactNode;
  /** Shown under the description (paths, status messages). */
  details?: ReactNode;
  /** Full-width block under the whole row (fine-tuning controls, previews). */
  below?: ReactNode;
  /** The control(s). */
  children?: ReactNode;
  /**
   * "row": control beside the text; "block": control below it;
   * "stacked": a wide control on its own full-width line under the label and
   * description, with `aside` on the title line. In "block" the label is only
   * read by assistive tech (the control carries its own caption).
   */
  layout?: "row" | "block" | "stacked";
  /** Stacked layout only: right-aligned on the title line (e.g. a switch). */
  aside?: ReactNode;
  /** Label element targets this control id. */
  htmlFor?: string;
  disabled?: boolean;
  /** Shows a ↺ button that restores the default. */
  onReset?: () => void;
  testId?: string;
  className?: string;
  /** Extra data-* attributes on the row (scope state). */
  data?: Record<`data-${string}`, string | undefined>;
}

export const SettingRow = ({
  id,
  label,
  description,
  details,
  below,
  children,
  layout = "row",
  aside,
  htmlFor,
  disabled = false,
  onReset,
  testId,
  className,
  data,
}: SettingRowProps) => {
  const schema =
    label === undefined
      ? getSettingSchema(id)
      : { label, description: undefined };
  const classes = [
    layout === "block" ? "vault-setting-block" : "vault-setting-row",
    layout === "stacked" && "vault-setting-row--stacked",
    disabled && "vault-setting-row--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const labelNode = htmlFor ? (
    <label className="vault-setting-label" htmlFor={htmlFor}>
      {schema.label}
    </label>
  ) : (
    <div className="vault-setting-label">{schema.label}</div>
  );
  if (layout === "stacked") {
    return (
      <div
        className={classes}
        data-setting-id={id}
        data-testid={testId}
        {...data}
      >
        <div className="vault-setting-stacked-head">
          <div className="vault-setting-label-line">{labelNode}</div>
          {aside}
        </div>
        <div className="vault-setting-desc">
          {description ?? schema.description}
        </div>
        {children && <div className="vault-setting-wide">{children}</div>}
        {details}
      </div>
    );
  }
  return (
    <div
      className={classes}
      data-setting-id={id}
      data-testid={testId}
      {...data}
    >
      <div className="vault-setting-info">
        <div className="vault-setting-label-line">{labelNode}</div>
        <div className="vault-setting-desc">
          {description ?? schema.description}
        </div>
        {details}
      </div>
      {layout === "block"
        ? children
        : (children || onReset) && (
            <div className="vault-setting-control">
              {children}
              {onReset && (
                <button
                  type="button"
                  className="vault-btn vault-btn--ghost vault-btn--icon vault-setting-reset"
                  onClick={onReset}
                  aria-label={`Reset ${schema.label}`}
                  title="Restore default"
                >
                  <IconRefresh width="14" height="14" />
                </button>
              )}
            </div>
          )}
      {below && <div className="vault-setting-below">{below}</div>}
    </div>
  );
};
