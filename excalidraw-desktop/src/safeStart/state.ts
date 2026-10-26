/** This launch's safe start, from `load_settings` (`safeStart`). Null in a normal start. */
export type SafeStartReason = "user" | "crashes" | "modifier" | "flag" | "env";

export type SafeStart = {
  reason: SafeStartReason;
  /** `plugins`: only plugins are off. `core`: built-in extensions and plugins are off. */
  scope: "plugins" | "core";
  crashedLaunches: number;
  pluginsAtCrash: string[];
};

let current: SafeStart | null = null;
const listeners = new Set<() => void>();

export function setSafeStart(s: SafeStart | null): void {
  if (JSON.stringify(s) === JSON.stringify(current)) {
    return;
  }
  current = s;
  listeners.forEach((l) => l());
}

export const getSafeStart = (): SafeStart | null => current;

export function subscribeSafeStart(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** True when built-in extensions must stay off (and plugins are not loaded). */
export const isCoreSafeStart = (): boolean => current?.scope === "core";

/** Why this launch is a safe start, in words (no trailing dot). */
export function safeStartReasonText(s: SafeStart): string {
  switch (s.reason) {
    case "flag":
      return "started with --safe";
    case "env":
      return "VAULTDRAW_SAFE is set";
    case "crashes":
      return `after ${s.crashedLaunches} crashed launches`;
    case "modifier":
      return "Option was held";
    default:
      return "you asked for it";
  }
}
