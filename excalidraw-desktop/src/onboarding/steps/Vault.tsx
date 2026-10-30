import { ChoiceGroup } from "../controls";

import type { StepProps, VaultChoice } from "../types";

const RECENT_SHOWN = 3;

/** The id used for a choice in the radio group. */
export const choiceId = (c: VaultChoice): string =>
  c.kind === "recent" ? `recent:${c.path}` : c.kind;

/** The choice that is selected when the step first shows. */
export const defaultVaultChoice = (env: {
  hasVault: boolean;
  recentVaults: readonly string[];
  lastVaultPath: string | null;
}): VaultChoice =>
  env.hasVault
    ? { kind: "keep" }
    : env.lastVaultPath && env.recentVaults.includes(env.lastVaultPath)
    ? { kind: "recent", path: env.lastVaultPath }
    : { kind: "open" };

export const Vault = ({ env }: StepProps) => {
  const options: {
    id: string;
    label: string;
    hint: string;
    choice: VaultChoice;
  }[] = [];
  if (env.hasVault) {
    options.push({
      id: "keep",
      label: "Keep the vault that is open",
      hint: "Nothing is opened or changed.",
      choice: { kind: "keep" },
    });
  }
  for (const path of env.recentVaults.slice(0, RECENT_SHOWN)) {
    options.push({
      id: `recent:${path}`,
      label: path,
      hint: "A vault you used before.",
      choice: { kind: "recent", path },
    });
  }
  options.push(
    {
      id: "open",
      label: "Open a folder",
      hint: "Use a folder of drawings you already have. Nothing in it changes until you save.",
      choice: { kind: "open" },
    },
    {
      id: "create",
      label: "Create a new vault",
      hint: "Start with a new, empty folder.",
      choice: { kind: "create" },
    },
    {
      id: "obsidian",
      label: "Open an Obsidian vault",
      hint: "Your notes stay as they are; nothing is converted unless you import.",
      choice: { kind: "obsidian" },
    },
    {
      id: "none",
      label: "Decide later",
      hint: "You will see the vault picker next.",
      choice: { kind: "none" },
    },
  );
  const byId = new Map(options.map((o) => [o.id, o.choice]));
  return (
    <>
      <ChoiceGroup<string>
        name="setup-vault"
        label="Vault"
        value={choiceId(env.vaultChoice)}
        options={options.map((o) => ({
          value: o.id,
          label: o.label,
          hint: o.hint,
        }))}
        onChange={(id) => env.setVaultChoice(byId.get(id) ?? { kind: "none" })}
      />
      {env.error && (
        <p className="vault-setup__error" role="alert">
          {env.error}
        </p>
      )}
    </>
  );
};
