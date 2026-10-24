/**
 * The AI master switch. Turning AI on always goes through the privacy warning
 * (`requestAiOn` only marks it pending; the dialog's "Turn on" calls
 * `confirmAiOn`). Turning it off, and the MCP sub-switch, act directly.
 * A hand edit of config.toml bypasses this on purpose: typing the key is consent.
 */
import { getPreferences, updatePreferences } from "../vault/preferences";

let pending = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

export const subscribeAiWarning = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isAiWarningPending = () => pending;

const setPending = (next: boolean) => {
  if (pending !== next) {
    pending = next;
    emit();
  }
};

/** Ask to turn AI on: shows the warning; nothing changes until it is confirmed. */
export const requestAiOn = (win?: Window | null) => {
  if (!getPreferences(win).aiEnabled) {
    setPending(true);
  }
};

export const confirmAiOn = (win?: Window | null) => {
  setPending(false);
  updatePreferences({ aiEnabled: true }, win);
};

export const cancelAiOn = () => setPending(false);

export const setAiOff = (win?: Window | null) => {
  setPending(false);
  if (getPreferences(win).aiEnabled) {
    updatePreferences({ aiEnabled: false }, win);
  }
};

/** `ai.toggle`: off -> warning first; on -> off at once. */
export const toggleAi = (win?: Window | null) => {
  if (getPreferences(win).aiEnabled) {
    setAiOff(win);
  } else {
    requestAiOn(win);
  }
};

/** `ai.toggleMcp`: flips ai.mcp_enabled (it only matters while AI is on). */
export const toggleMcp = (win?: Window | null) => {
  updatePreferences({ aiMcpEnabled: !getPreferences(win).aiMcpEnabled }, win);
};
