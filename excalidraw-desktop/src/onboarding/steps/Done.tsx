import { useSyncExternalStore } from "react";

import { EXTENSION_FIELDS } from "../../extensionSwitches/registry";
import { getSettingsStatus } from "../../vault/settingsSync";
import {
  getPreferences,
  isOffline,
  subscribePreferences,
} from "../../vault/preferences";

import { LINE_STYLES, SAVE_SPEEDS } from "./Basics";
import { SETUP_EXTRAS } from "./Extras";

import type { StepProps, VaultChoice } from "../types";

const on = (v: boolean) => (v ? "on" : "off");

export const vaultSummary = (c: VaultChoice): string => {
  switch (c.kind) {
    case "keep":
      return "the open vault stays";
    case "recent":
      return c.path;
    case "open":
      return "you pick a folder next";
    case "create":
      return "you create a new vault next";
    case "obsidian":
      return "you pick your Obsidian vault next";
    default:
      return "decided later";
  }
};

export const Done = ({ env }: StepProps) => {
  const prefs = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(env.win),
    () => getPreferences(env.win),
  );
  const extrasOn = SETUP_EXTRAS.filter(
    (e) => prefs[EXTENSION_FIELDS[e.id]],
  ).length;
  const save = SAVE_SPEEDS.find((s) => s.value === prefs.autosaveDelayMs);
  const lines = LINE_STYLES.find((s) => s.value === prefs.defaultRoughness);
  const rows: [string, string][] = [
    [
      "Look",
      `${
        prefs.theme === "system"
          ? "Follow system"
          : prefs.theme === "dark"
          ? "Dark"
          : "Light"
      }, ${prefs.colorTheme}`,
    ],
    [
      "Notes",
      `Vim keys ${on(prefs.notesVim)}, Markdown mode ${on(
        prefs.markdownTyping,
      )}`,
    ],
    [
      "Saving",
      `${save?.label ?? `${prefs.autosaveDelayMs} ms`}, ${(
        lines?.label ?? "custom"
      ).toLowerCase()} lines`,
    ],
    ["Internet", isOffline(prefs) ? "Offline mode" : "Online"],
    ["Extras", `${extrasOn} of ${SETUP_EXTRAS.length} on, AI assistant off`],
    ["Vault", vaultSummary(env.vaultChoice)],
  ];
  const path = getSettingsStatus().configPath ?? "config.toml";
  return (
    <>
      <dl className="vault-setup__summary" data-testid="setup-summary">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="vault-setup__note">
        Your choices are saved in <code>{path}</code>. You can change all of
        this in Settings or by editing that file. <em>Run setup again</em> in
        the command palette brings this back.
      </p>
    </>
  );
};
