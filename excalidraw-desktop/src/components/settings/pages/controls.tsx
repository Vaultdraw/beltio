import { useState, type KeyboardEvent } from "react";

import { IconChevronDown, IconReveal } from "../../Icons";
import { stepValue, typedValue, type StepRange } from "../stepper";

import "../colorPicker.css";

import { Path } from "../../Path";

/** Segmented buttons (one active). */
export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: {
  options: readonly { label: string; val: T }[];
  value: T;
  onChange: (val: T) => void;
  disabled?: boolean;
  /** Accessible name of the group. */
  label?: string;
}) => (
  <div className="vault-segmented-control" role="group" aria-label={label}>
    {options.map((o) => (
      <button
        key={String(o.val)}
        type="button"
        disabled={disabled}
        aria-pressed={value === o.val}
        className={`vault-segmented-btn ${
          value === o.val ? "vault-segmented-btn--active" : ""
        }`}
        onClick={() => onChange(o.val)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Toggle switch; `id` lets a SettingRow label target it. */
export const Switch = ({
  id,
  checked,
  onChange,
  label,
  disabled = false,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no visible label targets the input. */
  label?: string;
  disabled?: boolean;
  title?: string;
}) => (
  <label className="vault-switch" title={title}>
    <input
      id={id}
      type="checkbox"
      role="switch"
      checked={checked}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="vault-switch__track" aria-hidden="true">
      <span className="vault-switch__thumb" />
    </span>
  </label>
);

/**
 * Number stepper: the value plus two chevrons. The value is the one tab stop, a text field: type
 * a number and press Enter or leave the field (clamped and put on the grid; Escape goes back);
 * ArrowUp/Down step, PageUp/Down step x5, Home/End jump to the ends (hunter D-3).
 */
export const Stepper = ({
  value,
  onChange,
  unit,
  label,
  min,
  max,
  step,
}: StepRange & {
  value: number;
  onChange: (next: number) => void;
  unit?: string;
  label: string;
}) => {
  const range = { min, max, step };
  // What the user is typing; null while the field shows the value.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return; // nothing typed: leaving the field changes nothing (TN-4 family)
    }
    const next = typedValue(draft, range);
    setDraft(null);
    if (next !== null && next !== value) {
      onChange(next);
    }
  };
  const move = (dir: 1 | -1, times = 1) => {
    setDraft(null);
    let next = value;
    for (let i = 0; i < times; i++) {
      next = stepValue(next, dir, range);
    }
    if (next !== value) {
      onChange(next);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const key: Record<string, () => void> = {
      ArrowUp: () => move(1),
      ArrowDown: () => move(-1),
      PageUp: () => move(1, 5),
      PageDown: () => move(-1, 5),
      Home: () => onChange(min),
      End: () => onChange(max),
      Enter: commit,
      Escape: () => setDraft(null),
    };
    if (e.key === "Escape" && draft === null) {
      return; // nothing typed: Escape closes the dialog as usual
    }
    if ((e.key === "Home" || e.key === "End") && draft !== null) {
      return; // while typing, Home and End move the caret
    }
    if (key[e.key]) {
      e.preventDefault();
      key[e.key]();
    }
  };
  return (
    <div className="vault-stepper">
      <input
        className="vault-stepper__value"
        role="spinbutton"
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${value} ${unit}` : String(value)}
        size={Math.max(3, String(max).length + (unit ? unit.length + 1 : 0))}
        value={draft ?? (unit ? `${value} ${unit}` : String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="vault-stepper__arrows">
        <button
          type="button"
          tabIndex={-1}
          className="vault-stepper__btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => move(1)}
        >
          <IconChevronDown
            width="10"
            height="10"
            style={{ transform: "rotate(180deg)" }}
          />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="vault-stepper__btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => move(-1)}
        >
          <IconChevronDown width="10" height="10" />
        </button>
      </span>
    </div>
  );
};

/** A path (mono, truncated) and a Reveal button: Files and Recovery rows. */
export const RevealPath = ({
  path,
  onReveal,
  label,
}: {
  path: string;
  onReveal?: () => void;
  /** Accessible name of the button, e.g. "Reveal vault folder". */
  label: string;
}) => (
  <>
    <Path path={path} className="vault-files-path" />
    {onReveal && (
      <button
        type="button"
        className="vault-btn vault-btn--sm"
        aria-label={label}
        onClick={onReveal}
      >
        <IconReveal />
        <span>Reveal</span>
      </button>
    )}
  </>
);

export { ColorSwatches } from "./ColorSwatches";
