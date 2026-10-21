import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import {
  commandHandlersVersion,
  subscribeCommandHandlers,
} from "../commands/handlerRegistry";
import { useCommandShortcutLookup } from "../commands/useCommandShortcut";

import {
  resolveEntryState,
  type ActivityEntry,
  type ActiveStore,
  type EntryState,
} from "./entries";

import { useActivityEntries } from "./activityBarRegistry";
import { resolveActivityLayout } from "./layout";

import "./activityBar.css";

const NEVER_ACTIVE: ActiveStore = {
  subscribe: () => () => {},
  get: () => false,
};

const ActivityButton = ({
  entry,
  state,
  tabbable,
}: {
  entry: ActivityEntry;
  state: EntryState;
  tabbable: boolean;
}) => {
  const store = entry.active ?? NEVER_ACTIVE;
  const pressed = useSyncExternalStore(store.subscribe, store.get, () => false);
  const Icon = entry.icon;
  return (
    <button
      type="button"
      className="vault-ibtn vault-activity-bar__btn"
      data-testid={`activity-bar-${entry.id}`}
      data-entry={entry.id}
      title={state.title}
      aria-label={entry.label}
      aria-pressed={entry.active ? pressed : undefined}
      aria-disabled={state.disabled || undefined}
      tabIndex={tabbable ? 0 : -1}
    >
      <Icon aria-hidden="true" focusable="false" />
    </button>
  );
};

const entryOf = (target: EventTarget | null) => {
  const el = (target as HTMLElement | null)?.closest<HTMLButtonElement>(
    "button[data-entry]",
  );
  return el ?? null;
};

interface Props {
  /** Stable: runs a command through the dispatcher. */
  run: (commandId: string) => boolean;
  /** Stable: handler bound and `when` holds. */
  isAvailable: (commandId: string) => boolean;
  /** Stable: some handler is bound for the command. */
  hasHandler: (commandId: string) => boolean;
  /** Context facts that change availability; they re-render the bar. */
  drawingOpen: boolean;
  writable: boolean;
  /** Settings: entry ids in display order / hidden (see layout.ts). */
  order: readonly string[];
  hidden: readonly string[];
  win?: Window | null;
}

export const ActivityBar = memo(
  ({
    run,
    isAvailable,
    hasHandler,
    drawingOpen,
    writable,
    order,
    hidden: hiddenIds,
    win = null,
  }: Props) => {
    const entries = useActivityEntries();
    const shortcut = useCommandShortcutLookup(win);
    const handlersVersion = useSyncExternalStore(
      subscribeCommandHandlers,
      commandHandlersVersion,
      () => 0,
    );
    const visible = useMemo(
      () =>
        resolveActivityLayout(entries, order, hiddenIds).flatMap(
          ({ entry, hidden }) => {
            if (hidden) {
              return [];
            }
            const state = resolveEntryState(entry, {
              drawingOpen,
              hasHandler,
              isAvailable,
              shortcut,
            });
            return state.hidden ? [] : [{ entry, state }];
          },
        ),
      // drawingOpen, writable and handlersVersion change what is offered.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        hasHandler,
        isAvailable,
        shortcut,
        drawingOpen,
        writable,
        order,
        hiddenIds,
        handlersVersion,
        entries,
      ],
    );
    const [current, setCurrent] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const tabbableId = visible.some((v) => v.entry.id === current)
      ? current
      : visible[0]?.entry.id;

    // Entries pressed when the pointer went down. A panel that closes itself
    // on an outside pointerdown (the Library sidebar) is already closed by the
    // time the click lands; running its toggle then would reopen it.
    const pressedAtDown = useRef<string | null>(null);
    const onPointerDown = useCallback(
      (e: PointerEvent) => {
        const id = entryOf(e.target)?.dataset.entry;
        const entry = entries.find((x) => x.id === id);
        pressedAtDown.current = entry?.active?.get() ? entry.id : null;
      },
      [entries],
    );

    const onClick = useCallback(
      (e: MouseEvent) => {
        const button = entryOf(e.target);
        if (!button || button.getAttribute("aria-disabled") === "true") {
          return;
        }
        const entry = entries.find((x) => x.id === button.dataset.entry);
        const closedByPointerDown =
          entry && pressedAtDown.current === entry.id && !entry.active?.get();
        pressedAtDown.current = null;
        if (entry && !closedByPointerDown) {
          run(entry.commandId);
        }
      },
      [run, entries],
    );

    const onFocus = useCallback((e: FocusEvent) => {
      const button = entryOf(e.target);
      if (button) {
        setCurrent(button.dataset.entry ?? null);
        button.scrollIntoView?.({ block: "nearest" });
      }
    }, []);

    const onKeyDown = useCallback((e: KeyboardEvent) => {
      const buttons = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-entry]",
        ) ?? [],
      );
      const at = buttons.findIndex((b) => b === entryOf(e.target));
      if (at < 0) {
        return;
      }
      const target =
        e.key === "ArrowDown"
          ? buttons[Math.min(at + 1, buttons.length - 1)]
          : e.key === "ArrowUp"
          ? buttons[Math.max(at - 1, 0)]
          : e.key === "Home"
          ? buttons[0]
          : e.key === "End"
          ? buttons[buttons.length - 1]
          : null;
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }, []);

    const group = (name: "top" | "bottom") =>
      visible
        .filter((v) => v.entry.group === name)
        .map(({ entry, state }) => (
          <ActivityButton
            key={entry.id}
            entry={entry}
            state={state}
            tabbable={entry.id === tabbableId}
          />
        ));

    return (
      <div
        ref={rootRef}
        className="vault-activity-bar"
        data-testid="activity-bar"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Activity bar"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <div className="vault-activity-bar__group vault-activity-bar__group--top">
          {group("top")}
        </div>
        <div className="vault-activity-bar__group">{group("bottom")}</div>
      </div>
    );
  },
);
