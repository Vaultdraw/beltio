import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { allCommands } from "../../../commands/commands";
import {
  drawingOpenCommandId,
  parseDrawingOpenCommandId,
} from "../../../commands/drawingCommands";
import { pauseDispatcher } from "../../../commands/dispatcher";
import { conflictCount, findConflicts } from "../../../commands/conflicts";
import {
  chordFromEvent,
  detectPlatform,
  formatChordParts,
} from "../../../commands/keys";
import { parseSequence } from "../../../commands/keySequence";
import {
  effectiveKeys,
  isCustomised,
  overrideFor,
} from "../../../commands/keymap";
import {
  commandsVersion,
  registeredCommands,
  subscribeCommands,
} from "../../../commands/registry";
import {
  resetHotkeyOverrides,
  setHotkeyOverride,
  useHotkeyOverrides,
} from "../../../commands/useCommands";
import { openConfigDir } from "../../../vault/settingsSync";
import { useKeyOptions } from "../../../commands/useKeyOptions";
import { formatKeyLabel } from "../../../palette/shortcuts";
import { IconAlert, IconKeyboard, IconPlus, IconRefresh } from "../../Icons";
import { getSettingSchema } from "../schema";
import { useSettings, type SettingControls } from "../SettingsContext";

import {
  conflictSentence,
  FILTERS,
  filterCounts,
  filterInfos,
  groupByCategory,
  type FilterId,
  type HotkeyInfo,
} from "./hotkeysView";

import { KeyCaps } from "./KeyCaps";
import { KeyLabels } from "./KeyLabels";
import { stepRecorder } from "./sequenceRecorder";

import "./Hotkeys.css";

import type { Chord, CommandDefinition } from "../../../commands/types";

/** What the next key press is captured for: a command row, or the filter box. */
type Recording =
  | { kind: "command"; id: string }
  | { kind: "sequence"; id: string }
  | { kind: "filter" }
  | null;

/** Registry order is not display order: by category, then title. */
const sortCommands = (
  list: readonly CommandDefinition[],
): readonly CommandDefinition[] =>
  [...list].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
  );

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const HotkeysPage = () => {
  const { win: ctxWin, settingsStatus, pickDrawing } = useSettings();
  const win = ctxWin ?? (typeof window !== "undefined" ? window : null);
  const platform = useMemo(() => detectPlatform(win), [win]);
  const overrides = useHotkeyOverrides(win);
  const { leader, labels } = useKeyOptions(win);

  const [text, setText] = useState("");
  const [chordFilter, setChordFilter] = useState<Chord | null>(null);
  const [chip, setChip] = useState<FilterId>("all");
  const [recording, setRecording] = useState<Recording>(null);
  // Chords typed so far while recording a sequence.
  const [seq, setSeq] = useState<Chord[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const registryVersion = useSyncExternalStore(
    subscribeCommands,
    commandsVersion,
  );
  const commands = useMemo(
    () => allCommands(overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, registryVersion],
  );
  const sorted = useMemo(
    () => sortCommands(registeredCommands()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registryVersion],
  );
  const conflicts = useMemo(
    () => findConflicts(commands, overrides, platform),
    [commands, overrides, platform],
  );
  const conflictTotal = conflictCount(conflicts);

  const live = useRef({ overrides, platform, commands, seq });
  live.current = { overrides, platform, commands, seq };

  // Capture keys for the active recording. The dispatcher is paused and the
  // window capture listener swallows every key, so neither the app, Excalidraw
  // nor Settings' own Escape handler sees them.
  useEffect(() => {
    if (!recording || !win) {
      return;
    }
    const release = pauseDispatcher();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const {
        overrides: current,
        platform: plat,
        commands: known,
        seq: typed,
      } = live.current;
      const chord = chordFromEvent(e, plat);
      if (recording.kind === "sequence") {
        const command = known.find((c) => c.id === recording.id);
        const step = stepRecorder(typed, chord);
        if (!command || step.action === "ignore") {
          return;
        }
        if (step.action === "cancel") {
          setRecording(null);
          setSeq([]);
          setRefusal(null);
          return;
        }
        if (step.action === "update") {
          setRefusal(null);
          setSeq(step.chords);
          return;
        }
        const text = step.chords.join(" ");
        if (!parseSequence(text, plat)) {
          setRefusal(`Can't use ${text}: not a valid key sequence`);
          return;
        }
        setHotkeyOverride(
          command.id,
          overrideFor(
            command,
            [...effectiveKeys(command, current, plat), text],
            plat,
          ),
          win,
        );
        setRefusal(null);
        setSeq([]);
        setRecording(null);
        return;
      }
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setRecording(null);
        setRefusal(null);
        return;
      }
      if (!chord) {
        return; // modifier-only: keep waiting
      }
      if (recording.kind === "filter") {
        setChordFilter(chord);
        setRecording(null);
        return;
      }
      const command = known.find((c) => c.id === recording.id);
      if (!command) {
        return;
      }
      const write = (keys: Chord[]) =>
        setHotkeyOverride(command.id, overrideFor(command, keys, plat), win);
      if (chord === "Backspace" || chord === "Delete") {
        write([]);
      } else {
        write([...effectiveKeys(command, current, plat), chord]);
      }
      setRefusal(null);
      setRecording(null);
    };
    win.addEventListener("keydown", onKeyDown, true);
    return () => {
      win.removeEventListener("keydown", onKeyDown, true);
      release();
    };
  }, [recording, win]);

  const startRecording = (next: NonNullable<Recording>) => {
    setRefusal(null);
    setSeq([]);
    setRecording(next);
  };

  // Per-command facts, computed once per overrides change (not per keystroke).
  const infos = useMemo<HotkeyInfo[]>(() => {
    const drawings = commands
      .filter((c) => parseDrawingOpenCommandId(c.id) !== null)
      .sort((a, b) => a.title.localeCompare(b.title));
    return [...sorted, ...drawings].map((command) => ({
      command,
      keys: effectiveKeys(command, overrides, platform),
      customised: isCustomised(command, overrides, platform),
      conflicted: conflicts.has(command.id),
    }));
  }, [commands, sorted, overrides, platform, conflicts]);
  // The Conflicts chip counts conflicting (command, chord) pairs, as before.
  const counts = useMemo(
    () => ({ ...filterCounts(infos), conflicts: conflictTotal }),
    [infos, conflictTotal],
  );
  const rank = useMemo(
    () => new Map(commands.map((c, i) => [c.id, i] as const)),
    [commands],
  );

  const isDrawing = (c: CommandDefinition) =>
    parseDrawingOpenCommandId(c.id) !== null;
  const { groups, drawingRows } = useMemo(() => {
    const shown = filterInfos(infos, {
      text,
      chord: chordFilter,
      filter: chip,
    });
    return {
      groups: groupByCategory(shown.filter((i) => !isDrawing(i.command))),
      drawingRows: shown.filter((i) => isDrawing(i.command)),
    };
  }, [infos, text, chordFilter, chip]);
  const commandRowCount = groups.reduce((n, g) => n + g.infos.length, 0);

  const addDrawingShortcut = async () => {
    if (!pickDrawing) {
      return;
    }
    const path = await pickDrawing();
    if (!path) {
      return;
    }
    const id = drawingOpenCommandId(path);
    if (!(id in live.current.overrides)) {
      setHotkeyOverride(id, [], win);
    }
    startRecording({ kind: "command", id });
  };

  const [confirmReset, setConfirmReset] = useState(false);
  const resetAll = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    resetHotkeyOverrides((id) => parseDrawingOpenCommandId(id) !== null, win);
    setConfirmReset(false);
  };

  const pending = (
    <button
      type="button"
      className="vault-hotkeys__pending"
      aria-label="Cancel recording"
      onClick={() => setRecording(null)}
    >
      <IconKeyboard width="13" height="13" aria-hidden="true" />
      <span>Press keys…</span>
      <kbd>Esc</kbd>
      <span>cancels</span>
    </button>
  );

  const sequencePending = (
    <span
      className="vault-hotkeys__pending vault-hotkeys__pending--seq"
      role="status"
    >
      <IconKeyboard width="13" height="13" aria-hidden="true" />
      {seq.length === 0 ? (
        <span>Type the chords…</span>
      ) : (
        <span className="vault-hotkeys__seq-live">
          <KeyCaps
            keyText={seq.join(" ")}
            platform={platform}
            leader={leader}
          />
        </span>
      )}
      <span>Enter saves, Backspace undoes, Esc cancels</span>
      <button
        type="button"
        className="vault-hotkeys__cancel"
        aria-label="Cancel recording"
        onClick={() => {
          setRecording(null);
          setSeq([]);
        }}
      >
        ×
      </button>
    </span>
  );

  const renderRow = ({ command, keys, customised }: HotkeyInfo) => {
    const perChord = conflicts.get(command.id);
    const sentence = conflictSentence(command, perChord, rank, platform);
    const recordingSingle =
      recording?.kind === "command" && recording.id === command.id;
    const recordingSeq =
      recording?.kind === "sequence" && recording.id === command.id;
    const recordingHere = recordingSingle || recordingSeq;
    const addLabel = `Add hotkey for ${command.title}`;
    return (
      <li
        key={command.id}
        className={`vault-hotkeys__row${
          sentence ? " vault-hotkeys__row--conflict" : ""
        }`}
        data-command-id={command.id}
      >
        <div className="vault-hotkeys__name">
          <span className="vault-hotkeys__title">{command.title}</span>
          {customised && !isDrawing(command) && (
            <span
              className="vault-hotkeys__dot"
              title="Customised"
              role="img"
              aria-label="Customised"
            />
          )}
        </div>
        <div className="vault-hotkeys__keys">
          {keys.map((chord) => {
            const found = perChord?.get(chord);
            const label = formatKeyLabel(chord, platform, leader);
            return (
              <span
                key={chord}
                className="vault-hotkeys__chip-key"
                data-conflict={found ? "true" : undefined}
                title={label}
              >
                <KeyCaps keyText={chord} platform={platform} leader={leader} />
                <button
                  type="button"
                  className="vault-hotkeys__remove"
                  aria-label={`Remove ${label} from ${command.title}`}
                  onClick={() =>
                    setHotkeyOverride(
                      command.id,
                      overrideFor(
                        command,
                        keys.filter((k) => k !== chord),
                        platform,
                      ),
                      win,
                    )
                  }
                >
                  ×
                </button>
              </span>
            );
          })}
          {recordingSingle && pending}
          {recordingSingle && (
            <button
              type="button"
              className="vault-hotkeys__seq-btn"
              title="Record a key sequence such as g r"
              onClick={() =>
                startRecording({ kind: "sequence", id: command.id })
              }
            >
              Sequence
            </button>
          )}
          {recordingSeq && sequencePending}
          {!recordingHere && isDrawing(command) && (
            <button
              type="button"
              className="vault-hotkeys__icon-btn"
              aria-label={`Remove shortcut for ${command.title}`}
              title="Remove this drawing shortcut"
              onClick={() => setHotkeyOverride(command.id, null, win)}
            >
              ⌫
            </button>
          )}
          {!recordingHere && customised && !isDrawing(command) && (
            <button
              type="button"
              className="vault-hotkeys__icon-btn vault-hotkeys__reveal"
              aria-label={`Reset ${command.title} to default`}
              title="Reset to default"
              onClick={() => setHotkeyOverride(command.id, null, win)}
            >
              <IconRefresh width="13" height="13" aria-hidden="true" />
            </button>
          )}
          {!recordingHere &&
            (keys.length === 0 ? (
              <button
                type="button"
                className="vault-hotkeys__add vault-hotkeys__add--text"
                aria-label={addLabel}
                onClick={() =>
                  startRecording({ kind: "command", id: command.id })
                }
              >
                <IconPlus width="12" height="12" aria-hidden="true" />
                <span>Add shortcut</span>
              </button>
            ) : (
              <button
                type="button"
                className="vault-hotkeys__icon-btn vault-hotkeys__reveal"
                aria-label={addLabel}
                title="Add shortcut"
                onClick={() =>
                  startRecording({ kind: "command", id: command.id })
                }
              >
                <IconPlus width="12" height="12" aria-hidden="true" />
              </button>
            ))}
        </div>
        {recordingHere && refusal ? (
          <div className="vault-hotkeys__warn" role="alert">
            <IconAlert width="12" height="12" aria-hidden="true" />
            {refusal}
          </div>
        ) : (
          sentence && (
            <div
              className="vault-hotkeys__warn"
              data-testid="conflict-sentence"
            >
              <IconAlert width="12" height="12" aria-hidden="true" />
              {sentence}
            </div>
          )
        )}
      </li>
    );
  };

  const capturing = recording?.kind === "filter";

  const handleOpenConfig = async () => {
    setOpenError(null);
    try {
      await openConfigDir();
    } catch (err) {
      setOpenError(`Could not open the config folder: ${errorText(err)}`);
    }
  };

  return (
    <div className="vault-hotkeys" data-setting-id="hotkeys-list">
      <div className="vault-hotkeys__toolbar">
        <div className="vault-hotkeys__filter">
          {chordFilter ? (
            <span className="vault-hotkeys__chip-key">
              {formatChordParts(chordFilter, platform).map((part, i) => (
                <kbd key={i}>{part}</kbd>
              ))}
              <button
                type="button"
                className="vault-hotkeys__remove"
                aria-label="Clear key filter"
                onClick={() => setChordFilter(null)}
              >
                ×
              </button>
            </span>
          ) : capturing ? (
            pending
          ) : (
            <input
              type="search"
              className="vault-hotkeys__input"
              placeholder="Filter commands or press a shortcut"
              aria-label="Filter hotkeys"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          )}
          <button
            type="button"
            className={`vault-hotkeys__record ${
              capturing ? "vault-hotkeys__record--on" : ""
            }`}
            aria-pressed={capturing}
            aria-label="Record keys"
            title="Record keys: show every command bound to the next key you press"
            onClick={() =>
              capturing
                ? setRecording(null)
                : startRecording({ kind: "filter" })
            }
          >
            <IconKeyboard width="14" height="14" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="vault-hotkeys__chips" role="group" aria-label="Show">
        {FILTERS.filter(
          (f) => f.id !== "conflicts" || counts.conflicts > 0 || chip === f.id,
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`vault-hotkeys__filter-chip ${
              chip === id ? "vault-hotkeys__filter-chip--active" : ""
            } ${id === "conflicts" ? "vault-hotkeys__filter-chip--bad" : ""}`}
            aria-pressed={chip === id}
            onClick={() => setChip(id)}
          >
            {label}
            <span className="vault-hotkeys__badge">{counts[id]}</span>
          </button>
        ))}
        <button
          type="button"
          className="vault-hotkeys__reset-all"
          disabled={counts.customised === 0 && !confirmReset}
          onClick={resetAll}
          onBlur={() => setConfirmReset(false)}
        >
          <IconRefresh width="13" height="13" aria-hidden="true" />
          {confirmReset
            ? `Reset ${counts.customised}? Click again`
            : "Reset all"}
        </button>
      </div>

      <ul className="vault-hotkeys__list" aria-label="Hotkeys">
        {commandRowCount === 0 && drawingRows.length === 0 && (
          <li className="vault-settings-empty" role="status">
            No commands match.
          </li>
        )}
        {groups.map((group) => [
          <li
            key={`group:${group.category}`}
            className="vault-hotkeys__group"
            role="presentation"
          >
            {group.category}
          </li>,
          ...group.infos.map(renderRow),
        ])}
      </ul>

      {(pickDrawing || drawingRows.length > 0) && (
        <section
          className="vault-hotkeys__drawings"
          aria-label="Drawing shortcuts"
          data-testid="drawing-shortcuts"
        >
          <h3 className="vault-hotkeys__heading">Drawing shortcuts</h3>
          <ul className="vault-hotkeys__list" aria-label="Drawing shortcuts">
            {drawingRows.length === 0 && (
              <li className="vault-settings-empty" role="status">
                No drawing has a shortcut yet.
              </li>
            )}
            {drawingRows.map(renderRow)}
          </ul>
          {pickDrawing && (
            <button
              type="button"
              className="vault-btn vault-btn--sm"
              onClick={() => void addDrawingShortcut()}
            >
              Add drawing shortcut…
            </button>
          )}
        </section>
      )}

      <KeyLabels labels={labels} win={win} />

      {settingsStatus.mode === "tauri" && (
        <div className="vault-hotkeys__footer">
          <button
            type="button"
            className="vault-hotkeys__link"
            onClick={() => void handleOpenConfig()}
          >
            Open keys in config file
          </button>
          {openError && (
            <span className="vault-config-status--error" role="status">
              {openError}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/** Search results only point at the page; the full list lives on its page. */
const HotkeysSearchHint = () => (
  <p className="vault-settings-empty">
    {getSettingSchema("hotkeys-list").description}
  </p>
);

export const hotkeysControls: SettingControls = {
  "hotkeys-list": {
    Component: HotkeysPage,
    SearchComponent: HotkeysSearchHint,
  },
};
