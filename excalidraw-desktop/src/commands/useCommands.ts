/** React glue: live hotkey overrides, the window dispatcher and run(id). */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../vault/preferences";

import { allCommands, getCommand } from "./commands";
import {
  failingClauses,
  readContext,
  whenHolds,
  type AppContext,
} from "./context";
import { installCommandDispatcher, runHandler } from "./dispatcher";
import { getRegisteredHandler } from "./handlerRegistry";
import { detectPlatform } from "./keys";
import { buildKeymap } from "./keymap";
import { commandsVersion, subscribeCommands } from "./registry";

import type {
  Chord,
  CommandContext,
  CommandHandlers,
  HotkeyOverrides,
  Platform,
} from "./types";

/** `[hotkeys]` overrides, kept in sync with the preferences store. */
export function useHotkeyOverrides(win: Window | null): HotkeyOverrides {
  const [overrides, setOverrides] = useState<HotkeyOverrides>(
    () => getPreferences(win).hotkeys,
  );
  const lastJson = useRef(JSON.stringify(overrides));
  useEffect(() => {
    const sync = () => {
      const next = getPreferences(win).hotkeys;
      const json = JSON.stringify(next);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setOverrides(next);
      }
    };
    sync();
    return subscribePreferences(sync);
  }, [win]);
  return overrides;
}

/**
 * Set the override for `id`; null removes it (back to the defaults). Either
 * way the command's legacy-id entry is dropped, so it can't come back.
 */
export function setHotkeyOverride(
  id: string,
  keys: readonly Chord[] | null,
  win?: Window | null,
): void {
  const next = { ...getPreferences(win).hotkeys };
  const legacy = getCommand(id)?.legacy;
  if (legacy) {
    delete next[legacy.id];
  }
  if (keys === null) {
    delete next[id];
  } else {
    next[id] = [...keys];
  }
  updatePreferences({ hotkeys: next }, win);
}

export interface AvailabilityOptions {
  /**
   * Ignore `modalOpen`: the palette asks while its own backdrop is up (a
   * Mod+Enter run keeps it open), and only opens when no other modal is.
   */
  fromPalette?: boolean;
}

export interface CommandRunner {
  /** Run a command if it is available; true when a handler ran. */
  run(id: string, options?: AvailabilityOptions): boolean;
  isAvailable(id: string, options?: AvailabilityOptions): boolean;
  /** The `when` clauses of `id` that do not hold now (what makes it unavailable). */
  failedClauses(id: string, options?: AvailabilityOptions): string[];
  platform: Platform;
}

interface Options {
  handlers: CommandHandlers;
  app: AppContext;
}

/** `when` rules that depend on where the key was pressed do not apply to run(). */
const FOCUS_RULES = new Set([
  "textEditing",
  "canvasFocus",
  "listFocus",
  "galleryFocus",
  "graphFocus",
]);

export function useCommandDispatcher(
  doc: Document | null,
  win: Window | null,
  { handlers, app }: Options,
): CommandRunner {
  const platform = useMemo(() => detectPlatform(win), [win]);
  const overrides = useHotkeyOverrides(win);
  // Plugins (un)register commands at runtime: rebuild the keymap when they do.
  const registryVersion = useSyncExternalStore(
    subscribeCommands,
    commandsVersion,
  );
  const keymap = useMemo(
    () => buildKeymap(allCommands(overrides), overrides, platform),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, platform, registryVersion],
  );

  const live = useRef({ handlers, app, keymap });
  live.current = { handlers, app, keymap };
  const handlerFor = useCallback(
    (id: string) => live.current.handlers[id] ?? getRegisteredHandler(id),
    [],
  );

  const context = useCallback(
    (): CommandContext =>
      doc
        ? readContext(doc, live.current.app)
        : {
            ...live.current.app,
            textEditing: false,
            canvasFocus: false,
            modalOpen: false,
            listFocus: false,
            galleryFocus: false,
            graphFocus: false,
          },
    [doc],
  );

  useEffect(() => {
    if (!win) {
      return;
    }
    return installCommandDispatcher(win, {
      platform,
      getKeymap: () => live.current.keymap,
      getContext: context,
      getHandler: handlerFor,
    });
  }, [win, platform, context, handlerFor]);

  const activeWhen = useCallback(
    (id: string, options?: AvailabilityOptions) =>
      getCommand(id)?.when?.filter((clause) => {
        const key = clause.replace("!", "");
        return (
          !FOCUS_RULES.has(key) &&
          !(options?.fromPalette && key === "modalOpen")
        );
      }),
    [],
  );

  const isAvailable = useCallback(
    (id: string, options?: AvailabilityOptions) =>
      !!getCommand(id) &&
      !!handlerFor(id) &&
      whenHolds(activeWhen(id, options), context()),
    [activeWhen, context, handlerFor],
  );

  /** Only for the control API's UNAVAILABLE error; isAvailable stays allocation-light. */
  const failedClauses = useCallback(
    (id: string, options?: AvailabilityOptions) =>
      failingClauses(activeWhen(id, options), context()),
    [activeWhen, context],
  );

  const run = useCallback(
    (id: string, options?: AvailabilityOptions) => {
      const handler = handlerFor(id);
      if (!handler || !isAvailable(id, options)) {
        return false;
      }
      runHandler(id, handler);
      return true;
    },
    [isAvailable, handlerFor],
  );

  return { run, isAvailable, failedClauses, platform };
}

/**
 * Drops every hotkey override except the ids `keep` accepts (Reset all keeps
 * the drawing shortcuts, which are not defaults of any command).
 */
export function resetHotkeyOverrides(
  keep: (id: string) => boolean,
  win?: Window | null,
): void {
  const next = Object.fromEntries(
    Object.entries(getPreferences(win).hotkeys).filter(([id]) => keep(id)),
  );
  updatePreferences({ hotkeys: next }, win);
}
