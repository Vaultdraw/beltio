/**
 * "Rename tag across the vault": pick a tag (when none is given), type the new
 * spelling with live validation, see what would change (debounced plan), Enter
 * confirms, Esc cancels. Loaded lazily on first use.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { matchesWords } from "../../search/matchWords";
import { validateTagInput } from "../../tags/renameFlow";
import { errorMessage } from "../../vault/types";
import { Dialog } from "../Dialog";

import "./RenameTagDialog.css";

import type { TagCount, TagRenamePlan, VaultTagRename } from "../../tags/types";

export type TagRef = { key: string; display: string };

export interface RenameTagDialogProps {
  api: VaultTagRename;
  handle: string;
  /** Tags to choose from when `initial` is null. */
  tags(): readonly TagCount[];
  initial: TagRef | null;
  onConfirm(from: TagRef, to: string): Promise<void>;
  onCancel(): void;
  ownerDocument?: Document | null;
  /** Plan debounce in ms. */
  debounceMs?: number;
}

const PLAN_DEBOUNCE_MS = 250;
const MAX_ROWS = 50;

const PickTag = ({
  tags,
  onPick,
  onCancel,
}: {
  tags: readonly TagCount[];
  onPick(tag: TagRef): void;
  onCancel(): void;
}) => {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rows = useMemo(() => {
    // Each word in any order, folded, like every type-to-filter list (toimprove 246, 303).
    const q = query.trim().replace(/^#/, "");
    return tags
      .filter((t) => matchesWords(q, t.tag, t.display))
      .slice(0, MAX_ROWS);
  }, [tags, query]);
  const choose = (t: TagCount | undefined) =>
    t && onPick({ key: t.tag, display: t.display });
  return (
    <Dialog title="Rename tag" titleId="rename-tag-title" onClose={onCancel}>
      <input
        autoFocus
        className="vault-input"
        placeholder="Choose a tag to rename"
        aria-label="Tag"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
            e.preventDefault();
            setIndex(Math.min(index + 1, rows.length - 1));
          } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
            e.preventDefault();
            setIndex(Math.max(index - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(rows[index]);
          }
        }}
      />
      <ul className="vault-rename-tag__list" role="listbox">
        {rows.map((t, i) => (
          <li
            key={t.tag}
            role="option"
            aria-selected={i === index}
            className={i === index ? "is-active" : undefined}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(t)}
          >
            #{t.display}{" "}
            <span className="vault-rename-tag__count">{t.count}</span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="vault-rename-tag__empty">No matching tags</li>
        )}
      </ul>
    </Dialog>
  );
};

const PlanView = ({ plan }: { plan: TagRenamePlan }) => (
  <div className="vault-rename-tag__plan" data-testid="rename-tag-plan">
    <div>
      {plan.occurrences} {plan.occurrences === 1 ? "occurrence" : "occurrences"}{" "}
      in {plan.files} {plan.files === 1 ? "drawing" : "drawings"}
    </div>
    {plan.merges && (
      <div role="alert" className="vault-rename-tag__warn">
        Merges with existing #{plan.keys[0]?.to ?? plan.to}
      </div>
    )}
    {plan.keys.length > 1 && (
      <ul>
        {plan.keys.slice(0, MAX_ROWS).map((k) => (
          <li key={k.from}>
            #{k.from} {"→"} #{k.to}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const RenameStep = ({
  api,
  handle,
  from,
  onConfirm,
  onCancel,
  debounceMs,
}: {
  api: VaultTagRename;
  handle: string;
  from: TagRef;
  onConfirm(to: string): Promise<void>;
  onCancel(): void;
  debounceMs: number;
}) => {
  const [text, setText] = useState(from.display);
  const [plan, setPlan] = useState<TagRenamePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const checked = validateTagInput(text);
  const to = checked.ok ? checked.display : null;
  const changed = to !== null && to !== from.display;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!to || !changed) {
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      api
        .plan(handle, from.key, to)
        .then((p) => !stale && setPlan(p))
        .catch((e) => !stale && setPlanError(errorMessage(e)));
    }, debounceMs);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [api, handle, from.key, to, changed, debounceMs]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !changed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(to);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const message = !checked.ok ? checked.error : planError ?? error;
  return (
    <Dialog
      title={`Rename #${from.display}`}
      titleId="rename-tag-title"
      onClose={onCancel}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={busy || !changed}
          >
            {busy ? "Renaming…" : "Rename"}
          </button>
        </>
      }
    >
      <div className="vault-field">
        <label htmlFor="rename-tag-input">New tag</label>
        <input
          id="rename-tag-input"
          ref={input}
          className="vault-input"
          spellCheck={false}
          autoComplete="off"
          value={text}
          disabled={busy}
          aria-invalid={!checked.ok}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {message && <div className="vault-error-text">{message}</div>}
      </div>
      {plan && changed && <PlanView plan={plan} />}
    </Dialog>
  );
};

export default function RenameTagDialog({
  api,
  handle,
  tags,
  initial,
  onConfirm,
  onCancel,
  debounceMs = PLAN_DEBOUNCE_MS,
}: RenameTagDialogProps) {
  const [from, setFrom] = useState<TagRef | null>(initial);
  return from ? (
    <RenameStep
      api={api}
      handle={handle}
      from={from}
      debounceMs={debounceMs}
      onConfirm={(to) => onConfirm(from, to)}
      onCancel={onCancel}
    />
  ) : (
    <PickTag tags={tags()} onPick={setFrom} onCancel={onCancel} />
  );
}
