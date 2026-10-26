import { useSyncExternalStore, type ReactNode } from "react";

import { getSafeStart, subscribeSafeStart } from "../safeStart/state";

import { stepsFor } from "./bisect";
import {
  answer,
  extensionLabel,
  getBisectResult,
  stopBisect,
  subscribeBisectResult,
  turnOffAndStop,
} from "./bisectCommands";
import { getBisect, subscribeBisect } from "./bisectState";

const Button = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="vault-btn vault-btn--ghost"
    onClick={onClick}
  >
    {label}
  </button>
);

/** Shown while an extension bisect runs, then with its result. Mount once, above the canvas. */
export const BisectBanner = ({ win }: { win?: Window | null }) => {
  const state = useSyncExternalStore(subscribeBisect, getBisect);
  const result = useSyncExternalStore(subscribeBisectResult, getBisectResult);
  const safe = useSyncExternalStore(subscribeSafeStart, getSafeStart);
  if (!state) {
    return null;
  }
  let text: string;
  let buttons: ReactNode;
  if (result?.kind === "found") {
    text = `Found it: ${extensionLabel(result.id)} causes the problem.`;
    buttons = (
      <>
        <Button
          label={`Turn ${extensionLabel(result.id)} off and restart`}
          onClick={() => void turnOffAndStop(result.id, win)}
        />
        <Button label="Restart without changes" onClick={stopBisect} />
      </>
    );
  } else if (result?.kind === "none") {
    text =
      "The problem happens with every extension on and off: it is not an extension.";
    buttons = <Button label="Restart normally" onClick={stopBisect} />;
  } else if (safe) {
    // Everything is off in a safe start: an answer now would mislead the bisect.
    text = `Extension bisect, step ${state.step}, is paused: this is a safe start, so every extension is off. Restart to go on, or stop.`;
    buttons = <Button label="Stop" onClick={stopBisect} />;
  } else {
    const left = Math.max(1, stepsFor(state.suspects.length));
    text = `Extension bisect, step ${state.step} (at most ${left} more): ${
      state.off.length
    } of ${state.candidates.length} off (${state.off
      .map(extensionLabel)
      .join(", ")}). Does the problem still happen?`;
    buttons = (
      <>
        <Button label="It still happens" onClick={() => answer("still")} />
        <Button label="It's gone" onClick={() => answer("gone")} />
        <Button label="Stop" onClick={stopBisect} />
      </>
    );
  }
  return (
    <div
      className="vd-banner vd-banner--warning vd-safe-start"
      role="status"
      data-testid="bisect-banner"
    >
      <span className="vd-banner__text">{text}</span>
      {buttons}
    </div>
  );
};
