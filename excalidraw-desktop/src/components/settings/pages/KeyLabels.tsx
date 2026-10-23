import { useState } from "react";

import { checkKeyLabel, sameKeySequence } from "../../../commands/keySettings";
import { updatePreferences } from "../../../vault/preferences";

/**
 * `[keys.labels]`: the names which-key shows for key groups. One row per label,
 * edited in place; the config writer keeps the user's comments and order.
 */
export const KeyLabels = ({
  labels,
  win,
}: {
  labels: Readonly<Record<string, string>>;
  win: Window | null;
}) => {
  const [sequence, setSequence] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rows = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));

  const save = (next: Record<string, string>) =>
    updatePreferences({ keysLabels: next }, win);

  const add = () => {
    const checked = checkKeyLabel(sequence, text);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    // Another spelling of the same sequence is replaced, never duplicated.
    const same = Object.keys(labels).find((k) =>
      sameKeySequence(k, checked.sequence),
    );
    save({ ...labels, [same ?? checked.sequence]: checked.text });
    setSequence("");
    setText("");
  };

  return (
    <section
      className="vault-hotkeys__drawings vault-hotkeys__labels"
      aria-label="Key group names"
      data-testid="key-labels"
    >
      <h3 className="vault-hotkeys__heading">Key group names</h3>
      <p className="vault-settings-empty">
        Names which-key shows for a group of sequences, like{" "}
        <code>&lt;leader&gt; f</code> = file.
      </p>
      <ul className="vault-hotkeys__list" aria-label="Key group names">
        {rows.length === 0 && (
          <li className="vault-settings-empty" role="status">
            No names yet. A group shows “+N more”.
          </li>
        )}
        {rows.map(([seq, label]) => (
          <li key={seq} className="vault-key-labels__row">
            <code className="vault-key-labels__seq">{seq}</code>
            <input
              className="vault-input vault-input--compact"
              aria-label={`Name for ${seq}`}
              defaultValue={label}
              spellCheck={false}
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) => {
                const checked = checkKeyLabel(seq, e.target.value);
                if ("error" in checked) {
                  setError(checked.error);
                  e.target.value = label;
                } else if (checked.text !== label) {
                  setError(null);
                  save({ ...labels, [seq]: checked.text });
                }
              }}
            />
            <button
              type="button"
              className="vault-btn vault-btn--sm"
              aria-label={`Remove name for ${seq}`}
              onClick={() => {
                const next = { ...labels };
                delete next[seq];
                save(next);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="vault-key-labels__row">
        <input
          className="vault-input vault-input--compact"
          placeholder="<leader> f"
          aria-label="Key sequence"
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <input
          className="vault-input vault-input--compact"
          placeholder="file"
          aria-label="Name of the group"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="vault-btn vault-btn--sm" onClick={add}>
          Add name
        </button>
      </div>
      {error && (
        <span className="vault-config-status--error" role="status">
          {error}
        </span>
      )}
    </section>
  );
};
