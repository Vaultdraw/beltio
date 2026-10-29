import { useEffect, useRef, useState } from "react";

import {
  applyCanvasBackgroundFilter,
  applyDarkModeFilter,
} from "@excalidraw/common";

import { IconCheck } from "../../Icons";

import type { CSSProperties, KeyboardEvent } from "react";

const HEX_RE = /^#[0-9a-f]{6}$/i;
const HEX_PREFIX_RE = /^#[0-9a-f]{6}/i;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Dark or light check mark, whichever contrasts with the swatch. */
const checkTone = (color: string) => {
  if (!HEX_PREFIX_RE.test(color)) {
    return "dark";
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "dark" : "light";
};

const Check = () => (
  <IconCheck className="vault-cp__check" aria-hidden="true" focusable="false" />
);

const swatchStyle = (color: string) =>
  ({ "--vault-swatch": color } as CSSProperties);

/**
 * One-row colour field: optional "Default" chip, preset swatches, then a
 * distinct "custom" swatch (opens the native picker) and an optional hex
 * field. Exactly one item is selected (radiogroup).
 */
export const ColorSwatches = ({
  colors,
  value,
  onChange,
  swatchLabel,
  swatchTitle = (color) => color,
  canvasTheme,
  isCanvasBackground = false,
  customValue,
  customTitle,
  disabled = false,
  inputTestId,
  onClear,
  showHex = false,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  swatchLabel: (color: string) => string;
  swatchTitle?: (color: string) => string;
  /**
   * Set for colours drawn on the canvas (strokes, fills, pen, pattern):
   * swatches then show the colour as that canvas shows it, like Excalidraw's
   * own picker. Display only; values, labels and titles stay the real colour.
   */
  canvasTheme?: "light" | "dark";
  /** The colours are the canvas background (drawn by the background filter). */
  isCanvasBackground?: boolean;
  /** Value of the custom <input type=color> (must be #rrggbb). */
  customValue: string;
  customTitle: string;
  disabled?: boolean;
  inputTestId?: string;
  /** Shows a "Default" chip (selected when value is "") that calls this. */
  onClear?: () => void;
  /** Adds a #rrggbb text field (Enter or blur applies). */
  showHex?: boolean;
}) => {
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const dark = canvasTheme === "dark";
  /** The colour as drawn on screen (real colour when not a canvas colour). */
  const shown = (color: string) =>
    canvasTheme && color !== "transparent"
      ? (isCanvasBackground
          ? applyCanvasBackgroundFilter
          : applyDarkModeFilter)(color, dark)
      : color;
  const withNote = (title: string) =>
    dark ? `${title} (shown as on the dark canvas)` : title;
  const isPreset = colors.some((c) => same(c, value));
  const hasDefault = onClear !== undefined;
  const isDefault = hasDefault && value === "";
  const isCustom = !isPreset && !isDefault && HEX_RE.test(value);
  const customShown = isCustom ? value : customValue;

  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const hexText = HEX_RE.test(value) ? value : "";
  const commitHex = () => {
    const text = (draft ?? "").trim();
    setDraft(null);
    if (HEX_RE.test(text) && !same(text, value)) {
      onChange(text.toLowerCase());
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? -1
        : 0;
    if (!step) {
      return;
    }
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[role=radio]",
      ) ?? [],
    );
    const at = radios.indexOf(e.target as HTMLButtonElement);
    if (at < 0) {
      return;
    }
    e.preventDefault();
    radios[(at + step + radios.length) % radios.length].click();
    radios[(at + step + radios.length) % radios.length].focus();
  };

  // Roving tabindex: the selected radio, else the first one.
  const tabbable = isDefault
    ? "default"
    : isPreset
    ? colors.find((c) => same(c, value))
    : hasDefault
    ? "default"
    : colors[0];

  const radio = (
    key: string,
    selected: boolean,
    label: string,
    title: string,
    onPick: () => void,
    className: string,
    style?: CSSProperties,
    tone?: string,
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={title}
      tabIndex={tabbable === key ? 0 : -1}
      className={[
        "vault-cp__swatch",
        className,
        selected && "vault-cp__swatch--selected",
        tone && `vault-cp__swatch--${tone}`,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onClick={onPick}
    >
      {selected && <Check />}
    </button>
  );

  return (
    <fieldset
      ref={groupRef}
      className="vault-cp vault-fieldset"
      role="radiogroup"
      disabled={disabled}
      onKeyDown={onKeyDown}
    >
      {hasDefault &&
        radio(
          "default",
          isDefault,
          "Default (theme / app default)",
          "Default (theme / app default)",
          onClear,
          "vault-cp__swatch--default",
        )}
      {colors.map((color) =>
        radio(
          color,
          same(color, value),
          swatchLabel(color),
          color === "transparent"
            ? swatchTitle(color)
            : withNote(swatchTitle(color)),
          () => onChange(color),
          color === "transparent" ? "vault-cp__swatch--transparent" : "",
          color === "transparent" ? undefined : swatchStyle(shown(color)),
          color === "transparent" ? "dark" : checkTone(shown(color)),
        ),
      )}
      <label
        className={[
          "vault-cp__swatch",
          "vault-cp__custom",
          isCustom && "vault-cp__swatch--selected",
          isCustom && `vault-cp__swatch--${checkTone(shown(customShown))}`,
        ]
          .filter(Boolean)
          .join(" ")}
        style={isCustom ? swatchStyle(shown(customShown)) : undefined}
        title={customTitle}
      >
        {isCustom ? <Check /> : <span aria-hidden="true">+</span>}
        <input
          type="color"
          className="vault-cp__native"
          value={customShown}
          onChange={(e) => onChange(e.target.value)}
          aria-label={customTitle}
          data-testid={inputTestId}
        />
      </label>
      {showHex && (
        <input
          type="text"
          className="vault-input vault-input--compact vault-cp__hex"
          aria-label={`${customTitle} (hex)`}
          placeholder="#rrggbb"
          spellCheck={false}
          maxLength={7}
          value={draft ?? hexText}
          aria-invalid={draft !== null && draft !== "" && !HEX_RE.test(draft)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === "Enter" && commitHex()}
        />
      )}
    </fieldset>
  );
};
