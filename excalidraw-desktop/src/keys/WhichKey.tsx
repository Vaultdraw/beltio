/**
 * The which-key popup (lazy chunk). Lists what can follow the typed chords.
 * It never takes focus: continuation keys reach the dispatcher as usual, and
 * ArrowUp/ArrowDown/Enter are claimed through the key interceptor while open.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { advancePendingSequence } from "../commands/dispatcher";
import { formatChordParts } from "../commands/keys";
import { setKeyInterceptor } from "../commands/pendingKeys";

import { buildEntries } from "./whichKeyModel";
import "./whichKey.css";

import type { KeyView } from "../commands/pendingKeys";
import type { Chord } from "../commands/types";
import type { WhichKeyPosition } from "../commands/keySettings";

export interface WhichKeyProps {
  view: KeyView;
  /** Chords typed so far; empty = root entries (keys.whichKey). */
  path: readonly Chord[];
  labels: ReadonlyMap<string, string>;
  position: WhichKeyPosition;
  /** Close a popup shown without a pending sequence (Escape). */
  onClose(): void;
}

const Caps = ({ chord, view }: { chord: Chord; view: KeyView }) => (
  <span className="vault-whichkey__caps">
    {formatChordParts(chord, view.platform).map((part, i) => (
      <kbd key={i}>{part}</kbd>
    ))}
  </span>
);

export default function WhichKey({
  view,
  path,
  labels,
  position,
  onClose,
}: WhichKeyProps) {
  const entries = useMemo(
    () =>
      buildEntries({
        root: view.getSeqRoot(),
        path,
        ctx: view.getContext(),
        hasHandler: view.hasHandler,
        labels,
      }),
    [view, path, labels],
  );
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [path]);

  const live = useRef({ entries, active, path, onClose });
  live.current = { entries, active, path, onClose };
  useEffect(
    () =>
      setKeyInterceptor((chord) => {
        const cur = live.current;
        if (chord === "Escape" && cur.path.length === 0) {
          cur.onClose();
          return true;
        }
        const count = cur.entries.length;
        if (count === 0) {
          return false;
        }
        if (chord === "ArrowDown" || chord === "ArrowUp") {
          const step = chord === "ArrowDown" ? 1 : count - 1;
          setActive((cur.active + step) % count);
          return true;
        }
        if (chord === "Enter") {
          advancePendingSequence(cur.entries[cur.active % count].chord);
          return true;
        }
        return false;
      }),
    [],
  );

  return (
    <div
      className={`vault-whichkey vault-whichkey--${position}`}
      role="status"
      aria-live="polite"
      aria-label="Key sequence options"
    >
      <div className="vault-whichkey__card">
        {path.length > 0 && (
          <div className="vault-whichkey__path">
            {path.map((chord, i) => (
              <Caps key={i} chord={chord} view={view} />
            ))}
          </div>
        )}
        <ul className="vault-whichkey__list">
          {entries.map((entry, i) => (
            <li
              key={entry.chord}
              className={`vault-whichkey__entry vault-whichkey__entry--${
                entry.kind
              }${i === active ? " is-active" : ""}`}
              aria-current={i === active ? "true" : undefined}
            >
              <Caps chord={entry.chord} view={view} />
              <span className="vault-whichkey__label">{entry.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
