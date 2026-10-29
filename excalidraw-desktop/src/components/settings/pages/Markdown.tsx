/** Settings rows for Markdown mode (`[markdown]`): the default for new drawings, heading sizes, block gap. */
import { useSyncExternalStore } from "react";

import {
  BLOCK_GAP_LIMITS,
  HEADING_SIZE_LIMITS,
  type MarkdownPreferences,
} from "../../../markdown/markdownSettings";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../../vault/preferences";
import { SettingRow } from "../SettingRow";
import { useSettings, type SettingControls } from "../SettingsContext";

import { Stepper, Switch } from "./controls";

const usePref = <K extends keyof MarkdownPreferences>(
  win: Window | null,
  key: K,
) => useSyncExternalStore(subscribePreferences, () => getPreferences(win)[key]);

const TypingSetting = () => {
  const { win } = useSettings();
  const on = usePref(win, "markdownTyping");
  return (
    <SettingRow
      id="markdown-typing"
      htmlFor="vault-markdown-typing"
      testId="setting-markdown-typing"
    >
      <Switch
        id="vault-markdown-typing"
        checked={on}
        onChange={(next) => updatePreferences({ markdownTyping: next }, win)}
      />
    </SettingRow>
  );
};

const sizeSetting = (level: number) => {
  const field = `markdownH${level}Size` as keyof MarkdownPreferences;
  const SizeSetting = () => {
    const { win } = useSettings();
    const value = usePref(win, field) as number;
    return (
      <SettingRow id={`markdown-h${level}-size`}>
        <Stepper
          label={`Heading ${level} size`}
          value={value}
          unit="x"
          {...HEADING_SIZE_LIMITS}
          step={0.125}
          onChange={(next) => updatePreferences({ [field]: next }, win)}
        />
      </SettingRow>
    );
  };
  return SizeSetting;
};

const GapSetting = () => {
  const { win } = useSettings();
  const value = usePref(win, "markdownBlockGap");
  return (
    <SettingRow id="markdown-block-gap">
      <Stepper
        label="Space below a heading"
        value={value}
        unit="lines"
        {...BLOCK_GAP_LIMITS}
        step={0.25}
        onChange={(next) => updatePreferences({ markdownBlockGap: next }, win)}
      />
    </SettingRow>
  );
};

export const markdownControls: SettingControls = {
  "markdown-typing": { Component: TypingSetting },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `markdown-h${level}-size`,
      { Component: sizeSetting(level) },
    ]),
  ),
  "markdown-block-gap": { Component: GapSetting },
};
