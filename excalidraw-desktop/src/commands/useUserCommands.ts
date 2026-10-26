/**
 * Registers the `[commands.<name>]` user commands as `user.<name>` and runs
 * them through the shell's runner. Nothing registers while there are none.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

import { registerCommandPrefixHandler } from "./handlerRegistry";
import { registerCommands } from "./registry";
import {
  runSteps,
  USER_COMMAND_PREFIX,
  userCommandId,
  type StepRunner,
  type UserCommands,
} from "./userCommands";

import type { CommandDefinition } from "./types";

export const USER_COMMAND_CATEGORY = "User commands";

export const userCommandDefinitions = (
  commands: UserCommands,
): CommandDefinition[] =>
  Object.entries(commands).map(([name, command]) => ({
    id: userCommandId(name),
    title: command.title || name,
    category: USER_COMMAND_CATEGORY,
    keys: { default: [] },
    // A key does nothing while a dialog is open; the palette may still run it.
    when: ["!modalOpen"],
  }));

export function useUserCommands(
  win: Window | null,
  getRunner: () => StepRunner | null,
  notify: (message: string) => void,
): void {
  const commands = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win).userCommands,
  );
  // Compare by content: a reload that re-parses the same table re-registers nothing.
  const key = JSON.stringify(commands);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => commands, [key]);
  const live = useRef({ commands: stable, getRunner, notify });
  live.current = { commands: stable, getRunner, notify };

  useEffect(() => {
    if (Object.keys(stable).length === 0) {
      return;
    }
    const unregister = registerCommands(userCommandDefinitions(stable));
    const unbind = registerCommandPrefixHandler(
      USER_COMMAND_PREFIX,
      async (name) => {
        const command = live.current.commands[name];
        const runner = live.current.getRunner();
        if (!command || !runner) {
          return;
        }
        const result = await runSteps(command.run, runner);
        if (!result.ok) {
          live.current.notify(
            `${command.title || name} stopped at step ${result.step}: ${
              result.id
            } could not run`,
          );
        }
      },
    );
    return () => {
      unbind();
      unregister();
    };
  }, [stable]);
}
