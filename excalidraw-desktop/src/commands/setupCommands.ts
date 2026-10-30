/** First-run setup command. Rebindable, no default key. The handler is bound by the app shell (onboarding/useSetupCommand.ts). */
import type { CommandDefinition } from "./types";

export const SETUP_COMMAND_IDS = { run: "setup.run" } as const;

export const SETUP_COMMANDS: CommandDefinition[] = [
  {
    id: SETUP_COMMAND_IDS.run,
    title: "Run setup again",
    category: "Settings",
    keys: { default: [] },
  },
];
