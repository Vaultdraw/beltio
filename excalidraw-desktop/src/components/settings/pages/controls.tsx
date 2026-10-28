import { IconChevronDown, IconReveal } from "../../Icons";
import { stepValue, type StepRange } from "../stepper";

import "../colorPicker.css";

import { Path } from "../../Path";

import type { KeyboardEvent } from "react";

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
 * Number stepper: the value plus two chevrons. The value is the one tab stop
 * (ArrowUp/Down step, PageUp/Down step x5, Home/End jump to the ends).
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
  const move = (dir: 1 | -1, times = 1) => {
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
    };
    if (key[e.key]) {
      e.preventDefault();
      key[e.key]();
    }
  };
  return (
    <div className="vault-stepper">
      <span
        className="vault-stepper__value"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${value} ${unit}` : String(value)}
        onKeyDown={onKeyDown}
      >
        {value}
        {unit ? ` ${unit}` : ""}
      </span>
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
