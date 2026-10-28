import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ColorSwatches, Segmented } from "./controls";
import { useCanvasTheme } from "./useCanvasTheme";

// Excalidraw's real FONT_FAMILY ids (packages/common/src/constants.ts).
export const FONT_OPTIONS = [
  { id: 5, label: "Excalifont (Hand-drawn)" },
  { id: 6, label: "Nunito (Clean / Normal)" },
  { id: 8, label: "Comic Shanns (Code / Monospace)" },
  { id: 1, label: "Virgil (Classic hand-drawn)" },
  { id: 2, label: "Helvetica (Classic normal)" },
  { id: 3, label: "Cascadia (Classic code)" },
] as const;

export const STROKE_COLORS = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#099268",
  "#ffffff",
];

export const BG_COLORS = [
  "transparent",
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#eebefa",
  "#c3fae8",
  "#ffffff",
];

const FONT_SIZES = [
  { label: "16 (Small)", val: 16 },
  { label: "20 (Medium)", val: 20 },
  { label: "28 (Large)", val: 28 },
  { label: "36 (Extra Large)", val: 36 },
] as const;

const FILL_STYLES = [
  { label: "Solid", val: "solid" },
  { label: "Hachure", val: "hachure" },
  { label: "Cross-hatch", val: "cross-hatch" },
] as const;

const STROKE_WIDTHS = [
  { label: "Thin (1px)", val: 1 },
  { label: "Medium (2px)", val: 2 },
  { label: "Bold (4px)", val: 4 },
] as const;

const ROUGHNESS = [
  { label: "0: Architect (Clean)", val: 0 },
  { label: "1: Artist (Natural)", val: 1 },
  { label: "2: Cartoonist (Rough)", val: 2 },
] as const;

const FontFamilySetting = () => {
  const { defaults, updateDefaults } = useSettings();
  return (
    <SettingRow id="font-family">
      <select
        className="vault-input vault-input--font"
        aria-label="Default font family"
        value={defaults.defaultFontFamily}
        onChange={(e) =>
          updateDefaults({ defaultFontFamily: Number(e.target.value) })
        }
      >
        {!FONT_OPTIONS.some((f) => f.id === defaults.defaultFontFamily) && (
          <option value={defaults.defaultFontFamily}>
            {defaults.defaultFontFamily}: Other
          </option>
        )}
        {FONT_OPTIONS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id}: {f.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

const FontSizeSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  return (
    <SettingRow id="font-size">
      <Segmented<number>
        options={FONT_SIZES}
        value={defaults.defaultFontSize}
        onChange={(val) => updateDefaults({ defaultFontSize: val })}
      />
    </SettingRow>
  );
};

const StrokeColorSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  const canvasTheme = useCanvasTheme();
  const value = defaults.defaultStrokeColor;
  return (
    <SettingRow id="stroke-color">
      <ColorSwatches
        canvasTheme={canvasTheme}
        colors={STROKE_COLORS}
        value={value}
        onChange={(color) => updateDefaults({ defaultStrokeColor: color })}
        swatchLabel={(color) => `Stroke color ${color}`}
        customValue={value.startsWith("#") ? value : "#1e1e1e"}
        customTitle="Custom stroke color"
        showHex
      />
    </SettingRow>
  );
};

const BackgroundFillSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  const canvasTheme = useCanvasTheme();
  const value = defaults.defaultBackgroundColor;
  return (
    <SettingRow id="background-fill">
      <ColorSwatches
        canvasTheme={canvasTheme}
        colors={BG_COLORS}
        value={value}
        onChange={(color) => updateDefaults({ defaultBackgroundColor: color })}
        swatchLabel={(color) => `Fill color ${color}`}
        swatchTitle={(color) =>
          color === "transparent" ? "Transparent" : color
        }
        customValue={value.startsWith("#") ? value : "#ffffff"}
        customTitle="Custom background fill color"
        showHex
      />
    </SettingRow>
  );
};

const FillStyleSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  return (
    <SettingRow id="fill-style">
      <Segmented<string>
        options={FILL_STYLES}
        value={defaults.defaultFillStyle}
        onChange={(val) => updateDefaults({ defaultFillStyle: val })}
      />
    </SettingRow>
  );
};

const StrokeWidthSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  return (
    <SettingRow id="stroke-width">
      <Segmented<number>
        options={STROKE_WIDTHS}
        value={defaults.defaultStrokeWidth}
        onChange={(val) => updateDefaults({ defaultStrokeWidth: val })}
      />
    </SettingRow>
  );
};

const RoughnessSetting = () => {
  const { defaults, updateDefaults } = useSettings();
  return (
    <SettingRow id="roughness">
      <Segmented<number>
        options={ROUGHNESS}
        value={defaults.defaultRoughness}
        onChange={(val) => updateDefaults({ defaultRoughness: val })}
      />
    </SettingRow>
  );
};

export const drawingControls: SettingControls = {
  "font-family": { Component: FontFamilySetting },
  "font-size": { Component: FontSizeSetting },
  "stroke-color": { Component: StrokeColorSetting },
  "background-fill": { Component: BackgroundFillSetting },
  "fill-style": { Component: FillStyleSetting },
  "stroke-width": { Component: StrokeWidthSetting },
  roughness: { Component: RoughnessSetting },
};
