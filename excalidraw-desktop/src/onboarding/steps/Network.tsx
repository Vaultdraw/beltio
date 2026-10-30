import { useSyncExternalStore } from "react";

import {
  getPreferences,
  isOffline,
  subscribePreferences,
  updatePreferences,
} from "../../vault/preferences";
import { ChoiceGroup } from "../controls";

import type { StepProps } from "../types";

/** What each network feature does, in plain words. */
export const NETWORK_FEATURES = [
  ["Update check", "Once after start, asks GitHub if a newer version exists."],
  ["Web pictures", "Shows a picture from a web address inside a drawing."],
  ["Theme and plugin lists", "Fetched only when you open Browse or Install."],
] as const;

export const Network = ({ env }: StepProps) => {
  const { win, refreshAppearance } = env;
  const prefs = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win),
    () => getPreferences(win),
  );
  const offline = isOffline(prefs);
  return (
    <>
      <ChoiceGroup<boolean>
        name="setup-offline"
        label="Internet features"
        value={offline}
        columns={2}
        options={[
          { value: false, label: "Online", hint: "Features below just work." },
          {
            value: true,
            label: "Offline mode",
            hint: "Nothing leaves this computer.",
          },
        ]}
        onChange={(next) => {
          updatePreferences(
            { networkOffline: next, networkEnabled: true },
            win,
          );
          refreshAppearance();
        }}
      />
      <dl className="vault-setup__facts">
        {NETWORK_FEATURES.map(([name, what]) => (
          <div key={name} data-off={offline || undefined}>
            <dt>{name}</dt>
            <dd>{offline ? "Off while Offline mode is on." : what}</dd>
          </div>
        ))}
      </dl>
      <p className="vault-setup__note">
        Vaultdraw sends no usage data and runs no background calls for features
        you do not use.
      </p>
    </>
  );
};
