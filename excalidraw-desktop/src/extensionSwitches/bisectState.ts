/**
 * This launch's extension bisect (null when none runs), and how to save the
 * next step and restart. In the app the state is in the launch file and
 * arrives with the settings; in a plain browser (tests, the web harness) it
 * is kept in localStorage and a restart is a page reload.
 */
import { isTauriAvailable } from "../vault/DesktopVaultRepository";

import type { BisectState } from "./bisect";

const BROWSER_KEY = "vaultdraw.extensionBisect.v1";

const isList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** A stored state, or null when it is missing or malformed. */
export function parseBisect(v: unknown): BisectState | null {
  if (!v || typeof v !== "object") {
    return null;
  }
  const s = v as Record<string, unknown>;
  return isList(s.candidates) &&
    isList(s.suspects) &&
    isList(s.off) &&
    typeof s.step === "number"
    ? {
        candidates: s.candidates,
        suspects: s.suspects,
        off: s.off,
        step: s.step,
      }
    : null;
}

const readBrowser = (): BisectState | null => {
  try {
    const raw = globalThis.localStorage?.getItem(BROWSER_KEY);
    return raw ? parseBisect(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

let current: BisectState | null = isTauriAvailable() ? null : readBrowser();
let offSet: ReadonlySet<string> = new Set(current?.off ?? []);
const listeners = new Set<() => void>();

/** Set once from the settings reply (`bisect`), before extensions start. */
export function setBisect(state: BisectState | null): void {
  if (JSON.stringify(state) === JSON.stringify(current)) {
    return;
  }
  current = state;
  offSet = new Set(state?.off ?? []);
  listeners.forEach((l) => l());
}

export const getBisect = (): BisectState | null => current;

/** Whether a bisect turned `id` off for this launch. */
export const isBisectOff = (id: string): boolean => offSet.has(id);

export function subscribeBisect(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const invoke = async (cmd: string, args?: Record<string, unknown>) =>
  (await import("@tauri-apps/api/core")).invoke(cmd, args);

/**
 * Saves the state for the next launch (null ends the bisect) and restarts
 * normally: open drawings are saved first by the quit path.
 */
export async function saveBisectAndRestart(
  state: BisectState | null,
): Promise<void> {
  if (isTauriAvailable()) {
    await invoke("launch_bisect_set", { bisect: state });
    await invoke("app_restart_normally");
    return;
  }
  try {
    if (state) {
      globalThis.localStorage?.setItem(BROWSER_KEY, JSON.stringify(state));
    } else {
      globalThis.localStorage?.removeItem(BROWSER_KEY);
    }
  } catch {
    // No storage: the reload starts without a bisect.
  }
  globalThis.location?.reload();
}
