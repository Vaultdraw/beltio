/**
 * User commands: `[commands.<name>] run = ["id", …]` in config.toml, a name
 * for a list of existing commands (Helix's key-to-command-list, VS Code's
 * `runCommands`, Neovim's `:command`). No arguments, no conditions, no
 * scripting. Each becomes the palette command `user.<name>`, bindable in
 * `[hotkeys]` like any other.
 *
 * Pure parsing and running; useUserCommands.ts registers them.
 */
import type { SettingsProblem } from "../vault/settingsSync";

export const USER_COMMAND_PREFIX = "user.";
export const MAX_USER_COMMANDS = 200;
export const MAX_STEPS = 32;

export interface UserCommand {
  /** Palette label; the name when unset. */
  title?: string;
  /** Command ids, run in order. */
  run: readonly string[];
}

export type UserCommands = Readonly<Record<string, UserCommand>>;

export interface UserCommandsPreferences {
  userCommands: UserCommands;
}

export const USER_COMMANDS_DEFAULTS: UserCommandsPreferences = {
  userCommands: {},
};

/** Names are TOML bare keys: letters, digits, - and _. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

const isTable = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const userCommandId = (name: string): string =>
  `${USER_COMMAND_PREFIX}${name}`;

const problem = (key: string, message: string): SettingsProblem => ({
  kind: "invalid",
  key,
  message,
});

/** Why one entry is not a valid user command, or null. */
function entryProblem(name: string, value: unknown): string | null {
  if (!NAME.test(name)) {
    return `names use letters, digits, - and _`;
  }
  if (!isTable(value)) {
    return `expected a table like [commands.${name}] with run = ["…"]`;
  }
  for (const key of Object.keys(value)) {
    if (key !== "run" && key !== "title") {
      return `unknown key ${key} (expected run and title)`;
    }
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    return "title must be text";
  }
  const run = value.run;
  if (
    !Array.isArray(run) ||
    run.length === 0 ||
    !run.every((id) => typeof id === "string" && ID.test(id))
  ) {
    return 'run must be a list of command ids like ["export.png"]';
  }
  if (run.length > MAX_STEPS) {
    return `at most ${MAX_STEPS} steps`;
  }
  return null;
}

/**
 * Names whose steps can reach themselves through other user commands.
 * Depth-first search with three colours over the `user.*` steps.
 */
function cyclicNames(commands: Record<string, UserCommand>): Set<string> {
  const state = new Map<string, 1 | 2>();
  const bad = new Set<string>();
  const visit = (name: string, stack: string[]): void => {
    const s = state.get(name);
    if (s === 2) {
      return;
    }
    if (s === 1) {
      stack.slice(stack.indexOf(name)).forEach((n) => bad.add(n));
      return;
    }
    state.set(name, 1);
    stack.push(name);
    for (const id of commands[name].run) {
      const next = id.startsWith(USER_COMMAND_PREFIX)
        ? id.slice(USER_COMMAND_PREFIX.length)
        : null;
      if (next !== null && commands[next]) {
        visit(next, stack);
      }
    }
    stack.pop();
    state.set(name, 2);
  };
  Object.keys(commands).forEach((name) => visit(name, []));
  return bad;
}

/**
 * The `[commands]` table -> valid user commands. A bad entry is left out
 * with a problem; the rest apply. Commands in a cycle are all left out.
 */
export function parseUserCommands(table: unknown): {
  commands: UserCommands;
  problems: SettingsProblem[];
} {
  const problems: SettingsProblem[] = [];
  if (table === undefined) {
    return { commands: {}, problems };
  }
  if (!isTable(table)) {
    problems.push(
      problem("commands", "commands: expected tables like [commands.my-name]"),
    );
    return { commands: {}, problems };
  }
  const commands: Record<string, UserCommand> = {};
  for (const [name, value] of Object.entries(table)) {
    const key = `commands.${name}`;
    if (Object.keys(commands).length >= MAX_USER_COMMANDS) {
      problems.push(
        problem(
          key,
          `${key}: at most ${MAX_USER_COMMANDS} user commands; ignored`,
        ),
      );
      continue;
    }
    const why = entryProblem(name, value);
    if (why) {
      problems.push(problem(key, `${key}: ${why}; ignored`));
      continue;
    }
    const entry = value as { title?: string; run: string[] };
    commands[name] = {
      ...(entry.title ? { title: entry.title } : {}),
      run: [...entry.run],
    };
  }
  const cyclic = cyclicNames(commands);
  for (const name of cyclic) {
    problems.push(
      problem(
        `commands.${name}`,
        `commands.${name}: runs itself through ${USER_COMMAND_PREFIX}* steps; ignored`,
      ),
    );
    delete commands[name];
  }
  return { commands, problems };
}

/** Stored (localStorage) preferences -> valid user commands. */
export function normalizeUserCommandsPreferences(
  input: Record<string, unknown>,
): UserCommandsPreferences {
  return { userCommands: parseUserCommands(input.userCommands).commands };
}

export interface StepRunner {
  /** Run `id` if available and wait for it; false when it could not run. */
  runAndWait(id: string): Promise<boolean>;
}

export type RunResult = { ok: true } | { ok: false; step: number; id: string };

/** Run the steps in order, waiting for each; stop at the first that can't run. */
export async function runSteps(
  steps: readonly string[],
  runner: StepRunner,
): Promise<RunResult> {
  for (let i = 0; i < steps.length; i++) {
    if (!(await runner.runAndWait(steps[i]))) {
      return { ok: false, step: i + 1, id: steps[i] };
    }
  }
  return { ok: true };
}
