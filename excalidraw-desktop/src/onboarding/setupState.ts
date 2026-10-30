/**
 * When the first-run setup shows by itself. Pure, so it is unit tested.
 * A person who already has a recent vault (an app from before the setup
 * existed) counts as done; the palette command still runs it.
 */
export interface FirstRunFacts {
  completed: boolean;
  recentVaults: readonly string[];
  lastVaultPath: string | null;
  /** Perf and smoke builds drive the old welcome screen by script. */
  testBuild: boolean;
}

export const shouldShowFirstRun = (f: FirstRunFacts): boolean =>
  !f.completed &&
  !f.testBuild &&
  f.recentVaults.length === 0 &&
  !f.lastVaultPath;

/** Unit tests of the setup itself set this to see it; every other unit test starts at the old welcome screen. */
export const FORCE_SETUP_FLAG = "__vaultdrawForceSetup";

export const isHarnessBuild = (): boolean =>
  import.meta.env.VITE_APP_PERF_TEST === "true" ||
  import.meta.env.VITE_APP_SMOKE_TEST === "true" ||
  (import.meta.env.MODE === "test" &&
    !(globalThis as Record<string, unknown>)[FORCE_SETUP_FLAG]);
