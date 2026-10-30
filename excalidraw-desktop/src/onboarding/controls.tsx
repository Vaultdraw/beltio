import type { ReactNode } from "react";

/** A group of radio cards (arrow keys move, Space picks; Enter goes to the next screen). */
export function ChoiceGroup<T extends string | number | boolean>({
  name,
  label,
  value,
  options,
  onChange,
  columns,
  compact,
}: {
  name: string;
  label: string;
  value: T | null;
  options: readonly {
    value: T;
    label: string;
    hint?: string;
    disabled?: boolean;
    content?: ReactNode;
  }[];
  onChange: (next: T) => void;
  columns?: number;
  /** One row per choice (label beside its content). */
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="vault-setup__choices"
      style={columns ? { ["--setup-cols" as string]: columns } : undefined}
    >
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={`vault-setup__choice${
            compact ? " vault-setup__choice--theme" : ""
          }`}
          data-selected={value === o.value || undefined}
          data-disabled={o.disabled || undefined}
        >
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.content ?? (
            <>
              <span className="vault-setup__choice-label">{o.label}</span>
              {o.hint && (
                <span className="vault-setup__choice-hint">{o.hint}</span>
              )}
            </>
          )}
        </label>
      ))}
    </div>
  );
}

/** A labelled on/off row. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="vault-setup__row" htmlFor={id}>
      <span className="vault-setup__row-text">
        <span className="vault-setup__row-label">{label}</span>
        {hint && <span className="vault-setup__row-hint">{hint}</span>}
      </span>
      <span className="vault-setup__switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="vault-setup__switch-track" aria-hidden="true">
          <span className="vault-setup__switch-thumb" />
        </span>
      </span>
    </label>
  );
}
