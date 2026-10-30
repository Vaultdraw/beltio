import { useSyncExternalStore } from "react";

import {
  EAGER_THEME_IDS,
  builtinThemeFiles,
  builtinThemePreview,
} from "../../theme/builtins";
import { slugify } from "../../theme/normalize";
import { openInstallDialog } from "../../theme/install/installStore";
import {
  getPreferences,
  isOffline,
  resolveTheme,
  subscribePreferences,
  updatePreferences,
  type VaultTheme,
} from "../../vault/preferences";
import { ChoiceGroup } from "../controls";

import type { StepProps } from "../types";

const MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Follow system" },
] as const;

const useWindowPrefs = (win: Window) =>
  useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win),
    () => getPreferences(win),
  );

/** A small app window drawn with the live tokens, so it is the real theme. */
export const AppPreview = () => (
  <div
    className="vault-setup__preview"
    aria-hidden="true"
    data-testid="setup-preview"
  >
    <div className="vault-setup__preview-bar" />
    <div className="vault-setup__preview-body">
      <div className="vault-setup__preview-side">
        <i />
        <i data-on="" />
        <i />
      </div>
      <div className="vault-setup__preview-canvas">
        <b className="vault-setup__preview-box" />
        <b className="vault-setup__preview-dot" />
        <b className="vault-setup__preview-line" />
      </div>
    </div>
  </div>
);

export const Look = ({ env }: StepProps) => {
  const { win, refreshAppearance } = env;
  const prefs = useWindowPrefs(win);
  const mode = resolveTheme(prefs.theme, win);
  const offline = isOffline(prefs);
  const files = builtinThemeFiles().filter((f) =>
    (EAGER_THEME_IDS as readonly string[]).includes(f.id),
  );
  const current = slugify(prefs.colorTheme);
  const accents = (() => {
    const colors = builtinThemePreview(current)?.[mode];
    return colors
      ? [
          colors.terminal.blue,
          colors.terminal.green,
          colors.terminal.yellow,
          colors.terminal.red,
        ]
      : [];
  })();

  return (
    <>
      <ChoiceGroup<VaultTheme>
        name="setup-mode"
        label="Light or dark"
        value={prefs.theme}
        columns={3}
        options={MODES.map((m) => ({ value: m.value, label: m.label }))}
        onChange={(theme) => {
          updatePreferences({ theme }, win);
          refreshAppearance();
        }}
      />
      <AppPreview />
      <ChoiceGroup<string>
        name="setup-theme"
        label="Theme"
        value={current}
        columns={2}
        compact
        options={files.map((f) => {
          const c = builtinThemePreview(f.id)?.[mode];
          return {
            value: f.id,
            label: f.name,
            content: (
              <>
                <span className="vault-setup__swatches" aria-hidden="true">
                  {c &&
                    [
                      c.surface,
                      c.primary,
                      c.terminal.green,
                      c.terminal.red,
                    ].map((hex, i) => (
                      <i key={i} style={{ background: hex }} />
                    ))}
                </span>
                <span className="vault-setup__choice-label">{f.name}</span>
              </>
            ),
          };
        })}
        onChange={(id) => {
          const file = files.find((f) => f.id === id);
          updatePreferences(
            { colorTheme: file?.name ?? id, accentColor: "" },
            win,
          );
          refreshAppearance();
        }}
      />
      {accents.length > 0 && (
        <div className="vault-setup__accent">
          <span className="vault-setup__row-label" id="setup-accent-label">
            Accent colour
          </span>
          <div
            role="radiogroup"
            aria-labelledby="setup-accent-label"
            className="vault-setup__accent-list"
          >
            <label
              className="vault-setup__accent-opt"
              data-selected={prefs.accentColor === "" || undefined}
            >
              <input
                type="radio"
                name="setup-accent"
                aria-label="The theme's own"
                checked={prefs.accentColor === ""}
                onChange={() => {
                  updatePreferences({ accentColor: "" }, win);
                  refreshAppearance();
                }}
              />
              <span className="vault-setup__accent-own">Theme's own</span>
            </label>
            {accents.map((hex) => (
              <label
                key={hex}
                className="vault-setup__accent-opt"
                data-selected={
                  prefs.accentColor.toLowerCase() === hex.toLowerCase() ||
                  undefined
                }
              >
                <input
                  type="radio"
                  name="setup-accent"
                  aria-label={`Accent ${hex}`}
                  checked={
                    prefs.accentColor.toLowerCase() === hex.toLowerCase()
                  }
                  onChange={() => {
                    updatePreferences({ accentColor: hex }, win);
                    refreshAppearance();
                  }}
                />
                <i style={{ background: hex }} />
              </label>
            ))}
          </div>
        </div>
      )}
      <p className="vault-setup__note">
        {offline ? (
          "More themes can be browsed once Offline mode is off."
        ) : (
          <>
            More themes:{" "}
            <button
              type="button"
              className="vault-setup__link"
              onClick={() => openInstallDialog({ mode: "browse" })}
            >
              Browse community themes
            </button>
          </>
        )}
      </p>
    </>
  );
};
