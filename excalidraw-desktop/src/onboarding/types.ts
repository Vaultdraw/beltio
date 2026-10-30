import type { ComponentType } from "react";

/** What the person chose on the Vault step; acted on when the setup ends. */
export type VaultChoice =
  | { kind: "none" }
  | { kind: "keep" }
  | { kind: "open" }
  | { kind: "create" }
  | { kind: "obsidian" }
  | { kind: "recent"; path: string };

/** What every step can read and do. Settings are written straight to the config (updatePreferences). */
export interface SetupEnv {
  win: Window;
  /** A vault is open (the setup was started from the palette). */
  hasVault: boolean;
  recentVaults: readonly string[];
  lastVaultPath: string | null;
  vaultChoice: VaultChoice;
  setVaultChoice: (choice: VaultChoice) => void;
  /** Re-resolve the theme after a change, so the whole window follows at once. */
  refreshAppearance: () => void;
  error?: string | null;
}

export interface StepProps {
  env: SetupEnv;
}

/**
 * One screen. The list in steps.ts is the whole flow: add, remove or reorder
 * a step by editing that list only.
 */
export interface SetupStep {
  id: string;
  /** The question or heading. */
  title: (env: SetupEnv) => string;
  subtitle?: (env: SetupEnv) => string;
  /** Label of the primary button (default "Next"; the last step's runs the setup's end). */
  nextLabel?: (env: SetupEnv) => string;
  /** The first screen shows the app mark above the title. */
  hero?: boolean;
  Component: ComponentType<StepProps>;
}
