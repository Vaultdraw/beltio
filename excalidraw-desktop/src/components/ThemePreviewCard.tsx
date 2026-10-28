import "./themePreview.css";

import type { ThemeMode, ThemePreviewColors } from "../theme";
import type { CatalogueEntry } from "../theme/catalogue/types";

export const ThemeHalf = ({
  colors: c,
  mode,
  generated,
}: {
  colors: ThemePreviewColors;
  mode: ThemeMode;
  generated: boolean;
}) => (
  <div
    className="vault-theme-card__half"
    data-mode={mode}
    style={{ backgroundColor: c.surface, color: c.onSurface }}
  >
    <div
      className="vault-theme-card__line"
      style={{ backgroundColor: c.onSurface }}
    />
    <div
      className="vault-theme-card__line vault-theme-card__line--short"
      style={{ backgroundColor: c.onSurface }}
    />
    <div className="vault-theme-card__swatches">
      <span
        className="vault-theme-card__pill"
        style={{ backgroundColor: c.primary }}
      />
      <span
        className="vault-theme-card__dot"
        style={{ backgroundColor: c.onSurface }}
      />
      <span
        className="vault-theme-card__dot"
        style={{ backgroundColor: c.onSurface }}
      />
    </div>
    {generated && (
      <span
        className="vault-theme-card__auto"
        style={{ color: c.onSurfaceVariant, borderColor: c.outline }}
        title={`The ${mode} variant is generated from the other one`}
      >
        auto
      </span>
    )}
  </div>
);

/**
 * The same mini window for a catalogue entry, built from its palette
 * (surface, text, accent per mode), so no preview image is fetched. A mode the
 * entry lacks shows the other one, marked "auto" like generated variants.
 */
export const PalettePreview = ({ entry }: { entry: CatalogueEntry }) => {
  const { dark, light } = entry.swatch;
  const have = dark ?? light;
  if (!have) {
    return null;
  }
  return (
    <>
      {(["dark", "light"] as const).map((mode: ThemeMode) => {
        const c = entry.swatch[mode] ?? have;
        return (
          <ThemeHalf
            key={mode}
            mode={mode}
            colors={paletteColors(c)}
            generated={!entry.swatch[mode]}
          />
        );
      })}
    </>
  );
};

/** [surface, text, accent] from the catalogue index; the rest follows from them. */
const paletteColors = ([
  surface,
  onSurface,
  primary = onSurface,
]: string[]): ThemePreviewColors => ({
  surface,
  onSurface,
  surfaceVariant: surface,
  onSurfaceVariant: onSurface,
  outline: onSurface,
  primary,
  terminal: { red: primary, yellow: primary, green: primary, blue: primary },
});
