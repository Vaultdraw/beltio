import { useState } from "react";

import { userError } from "../../userError";

import { getSnippetSource } from "../../../snippets/store";
import { resolveAccent } from "../../../theme/accent";
import { openThemesDir } from "../../../theme/registry";
import { openInstallDialog } from "../../../theme/install/installStore";
import {
  removedNotice,
  THEMES_REPO,
  THEMES_REPO_URL,
} from "../../../theme/removedThemes";
import { resolveTheme, updatePreferences } from "../../../vault/preferences";
import { usePreference } from "../usePreference";
import { IconFolder } from "../../Icons";
import { ThemePicker } from "../../ThemePicker";
import { accentSwatches } from "../accentSwatches";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { ExternalLink } from "../../../help/ExternalLink";

import { ColorSwatches, Segmented, Stepper, Switch } from "./controls";
import { useCanvasTheme } from "./useCanvasTheme";
import { PaperSetting } from "./PaperSetting";
import { SnippetsSetting } from "./Snippets";
import { useScopedRowProps } from "./scopedRow";

import type { CSSProperties } from "react";

import type { VaultTheme } from "../../../vault/preferences";

const MODES: readonly { key: VaultTheme; label: string }[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

const CANVAS_BG_COLORS = [
  "#ffffff",
  "#f8f9fa",
  "#f1f3f5",
  "#1e1e24",
  "#121214",
  "#18191c",
];

const ModeSetting = () => {
  const { mode, setMode } = useSettings();
  const scoped = useScopedRowProps("mode", "theme");
  return (
    <SettingRow id="mode" {...scoped}>
      <Segmented
        label="Mode"
        options={MODES.map((m) => ({ label: m.label, val: m.key }))}
        value={mode}
        onChange={setMode}
      />
    </SettingRow>
  );
};

const ColourThemeSetting = () => {
  const { registry, selection, selectColourTheme } = useSettings();
  const userThemeProblems = registry.fileProblems;
  const scoped = useScopedRowProps("colour-theme", "colorTheme");
  return (
    <SettingRow
      id="colour-theme"
      layout="block"
      testId="settings-theme"
      {...scoped}
    >
      <ThemePicker
        themes={registry.themes}
        selectedKey={selection.entry.key}
        onSelect={selectColourTheme}
      />
      {selection.problem && (
        <div className="vault-theme-problem" role="status">
          {selection.problem}
        </div>
      )}
      {userThemeProblems.length > 0 && (
        <ul className="vault-theme-problems" aria-label="Theme file problems">
          {userThemeProblems.map((p) => (
            <li
              key={`${p.path}:${p.message}`}
              className={`vault-theme-problems__item vault-theme-problems__item--${p.kind}`}
              title={p.path}
            >
              {p.message}
            </li>
          ))}
        </ul>
      )}
      {registry.loadError && (
        <div className="vault-theme-problem" role="status">
          {registry.loadError}
        </div>
      )}
    </SettingRow>
  );
};

const SyncCanvasSetting = () => {
  const { syncCanvas, setSyncCanvas } = useSettings();
  return (
    <SettingRow id="sync-canvas" htmlFor="vault-sync-canvas">
      <Switch
        id="vault-sync-canvas"
        checked={syncCanvas}
        onChange={setSyncCanvas}
      />
    </SettingRow>
  );
};

const CanvasBackgroundSetting = () => {
  const { syncCanvas, defaults, updateDefaults } = useSettings();
  const canvasTheme = useCanvasTheme();
  const value = defaults.defaultCanvasBackground ?? "#ffffff";
  return (
    <SettingRow
      id="canvas-background"
      disabled={syncCanvas}
      testId="settings-canvas-background"
      stackWhenNarrow
      description={
        syncCanvas
          ? "The canvas follows the theme while sync is on."
          : undefined
      }
    >
      <ColorSwatches
        canvasTheme={canvasTheme}
        isCanvasBackground
        colors={CANVAS_BG_COLORS}
        value={value}
        onChange={(color) => updateDefaults({ defaultCanvasBackground: color })}
        swatchLabel={(color) => `Canvas color ${color}`}
        customValue={value}
        customTitle="Custom canvas background color"
        disabled={syncCanvas}
      />
    </SettingRow>
  );
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

const AccentSetting = () => {
  const { win, mode, selection, accentColor, setAccentColor } = useSettings();
  const resolvedMode = resolveTheme(mode, win);
  const variant = selection.entry.theme[resolvedMode];
  const resolved = resolveAccent(variant, accentColor, resolvedMode);
  const own = resolveAccent(variant, "", resolvedMode).primary;
  const { swatches, custom } = accentSwatches(own, accentColor);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? accentColor;
  const scoped = useScopedRowProps(
    "accent-colour",
    "accentColor",
    accentColor && resolved.adjusted ? (
      <div className="vault-setting-note" role="status">
        Adjusted for contrast: {resolved.primary}
      </div>
    ) : undefined,
  );
  const commitDraft = () => {
    // Nothing typed since the last commit (Enter, then a click elsewhere blurs the field): keep
    // the colour. Treating "no draft" as "cleared" erased the accent (test-net TN-4).
    if (draft === null) {
      return;
    }
    const text = draft.trim();
    setDraft(null);
    if (text === "") {
      setAccentColor("");
    } else if (HEX_RE.test(text)) {
      setAccentColor(text.toLowerCase());
    }
  };
  return (
    <SettingRow id="accent-colour" testId="settings-accent" {...scoped}>
      <div className="vault-accent" role="group" aria-label="Accent">
        {swatches.map((sw) => (
          <button
            key={sw.name}
            type="button"
            aria-pressed={sw.selected}
            aria-label={sw.name}
            title={sw.name}
            className={`vault-accent__sw ${
              sw.selected ? "vault-accent__sw--on" : ""
            }`}
            style={{ "--sw": sw.paint } as CSSProperties}
            onClick={() => setAccentColor(sw.hex)}
          />
        ))}
        <label
          className={`vault-accent__sw vault-accent__custom ${
            custom ? "vault-accent__sw--on vault-accent__custom--set" : ""
          }`}
          title="Custom accent colour"
          style={custom ? ({ "--sw": custom } as CSSProperties) : undefined}
        >
          +
          <input
            type="color"
            aria-label="Accent colour picker"
            value={resolved.primary}
            onChange={(e) => setAccentColor(e.target.value)}
          />
        </label>
        <input
          type="text"
          className="vault-input vault-input--compact"
          aria-label="Accent colour hex"
          placeholder="Theme default"
          spellCheck={false}
          value={shown}
          aria-invalid={
            draft !== null && draft !== "" && !HEX_RE.test(draft.trim())
          }
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
            }
          }}
        />
      </div>
    </SettingRow>
  );
};

const ThemesFolderSetting = () => {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try {
      await openThemesDir();
    } catch (err) {
      setError(`Couldn't open the themes folder. ${userError(err, "")}`.trim());
    }
  };
  return (
    <SettingRow
      id="themes-folder"
      testId="themes-folder"
      details={
        error && (
          <div
            className="vault-config-status vault-config-status--error"
            role="status"
          >
            {error}
          </div>
        )
      }
    >
      <button
        type="button"
        className="vault-btn vault-btn--sm"
        onClick={() => void open()}
      >
        <IconFolder />
        <span>Open themes folder</span>
      </button>
    </SettingRow>
  );
};

const InstallThemeSetting = () => {
  const removed = useSettings().selection.removed;
  return (
    <SettingRow
      id="install-theme"
      testId="settings-install-theme"
      details={
        removed && (
          <div className="vault-theme-problem" role="status">
            {removedNotice(removed)}{" "}
            <ExternalLink href={THEMES_REPO_URL}>{THEMES_REPO}</ExternalLink>
          </div>
        )
      }
    >
      <div className="vault-config-actions">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => openInstallDialog({ mode: "browse" })}
        >
          Install more themes…
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() =>
            openInstallDialog(
              removed
                ? { mode: "install", input: THEMES_REPO, pick: removed }
                : { mode: "install" },
            )
          }
        >
          {removed ? `Install ${removed}` : "Install from link…"}
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => openInstallDialog({ mode: "update" })}
        >
          Update
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => openInstallDialog({ mode: "uninstall" })}
        >
          Remove…
        </button>
      </div>
    </SettingRow>
  );
};

const ThemeMaxSizeSetting = () => {
  const kb = usePreference("themeInstallMaxKb");
  return (
    <SettingRow id="theme-max-size">
      <Stepper
        label="Largest theme file"
        unit="KiB"
        min={8}
        max={256}
        step={8}
        value={kb}
        onChange={(next) => updatePreferences({ themeInstallMaxKb: next })}
      />
    </SettingRow>
  );
};

const ThemePreviewsSetting = () => {
  const on = usePreference("themesPreviews");
  return (
    <SettingRow id="theme-previews" htmlFor="vault-theme-previews">
      <Switch
        id="vault-theme-previews"
        checked={on}
        onChange={(next) => updatePreferences({ themesPreviews: next })}
      />
    </SettingRow>
  );
};

const ThemeIndexTtlSetting = () => {
  const hours = usePreference("themesIndexTtlHours");
  return (
    <SettingRow id="theme-index-ttl">
      <Stepper
        label="Keep the list for"
        unit="hours"
        min={0}
        max={720}
        step={6}
        value={hours}
        onChange={(next) => updatePreferences({ themesIndexTtlHours: next })}
      />
    </SettingRow>
  );
};

export const appearanceControls: SettingControls = {
  mode: { Component: ModeSetting },
  "colour-theme": { Component: ColourThemeSetting },
  "sync-canvas": { Component: SyncCanvasSetting },
  "accent-colour": { Component: AccentSetting },
  "canvas-background": { Component: CanvasBackgroundSetting },
  paper: { Component: PaperSetting },
  "install-theme": { Component: InstallThemeSetting },
  "theme-max-size": { Component: ThemeMaxSizeSetting },
  "theme-previews": { Component: ThemePreviewsSetting },
  "theme-index-ttl": { Component: ThemeIndexTtlSetting },
  "themes-folder": {
    Component: ThemesFolderSetting,
    available: (ctx) => ctx.registry.mode === "tauri",
  },
  "css-snippets": {
    Component: SnippetsSetting,
    available: (ctx) => getSnippetSource(ctx.win) !== null,
  },
};
