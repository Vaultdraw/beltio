import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { TASK_TITLES, SYSTEM, type Task } from "./prompts";

import type { Session } from "./session";

const TASKS: Task[] = ["ask", "describe", "diagram", "summarise"];

const PLACEHOLDER: Record<Task, string> = {
  ask: "Ask about this drawing",
  describe: "Describe the selection (add a note if you like)",
  diagram: "Describe the diagram to draw, e.g. login flow with a retry",
  summarise: "Summarise (add a note if you like)",
};

export default function Panel({ session }: { session: Session }) {
  const s = useSyncExternalStore(session.subscribe, session.get);
  const [draft, setDraft] = useState("");
  const [key, setKey] = useState("");
  const [showSent, setShowSent] = useState(false);
  const [preview, setPreview] = useState<{ sent: string; summary: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const keyBox = useRef<HTMLInputElement>(null);
  const keyDetails = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    void session.refreshKey();
  }, [session]);

  useEffect(() => {
    if (s.focus.tick === 0) {
      return;
    }
    if (s.focus.target === "key") {
      if (keyDetails.current) {
        keyDetails.current.open = true;
      }
      keyBox.current?.focus();
    } else {
      box.current?.focus();
    }
  }, [s.focus.tick, s.focus.target]);

  // The "what is sent" view follows the drawing and the question until it is sent.
  useEffect(() => {
    if (!showSent || s.status === "running") {
      return;
    }
    let live = true;
    void session.preview(s.task, draft).then((p) => {
      if (live) {
        setPreview({ sent: p.sent, summary: p.context?.summary ?? "" });
      }
    });
    return () => {
      live = false;
    };
  }, [showSent, s.task, draft, s.status, session]);

  const running = s.status === "running";
  const send = () => {
    if (!running) {
      void session.run(s.task, draft);
      if (s.task === "ask") {
        setDraft("");
      }
    }
  };
  const sent = running || s.answer || s.error ? s.sent : preview?.sent ?? "";
  const ctxSummary = running || s.answer ? s.context?.summary : preview?.summary;

  return (
    <div className="vd-ai">
      <div className="vd-ai-head">
        <strong>AI assistant</strong>
        <span className="vd-ai-via">{s.via || session.config().provider}</span>
      </div>

      <div className="vd-ai-tasks" role="tablist" aria-label="What to do">
        {TASKS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={s.task === t}
            className="vd-ai-task"
            onClick={() => session.setTask(t)}
          >
            {TASK_TITLES[t]}
          </button>
        ))}
      </div>

      <textarea
        ref={box}
        className="vd-ai-input"
        aria-label={PLACEHOLDER[s.task]}
        placeholder={PLACEHOLDER[s.task]}
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && running) {
            e.stopPropagation();
            session.cancel();
          }
        }}
      />
      <div className="vd-ai-row">
        {running ? (
          <button className="vd-ai-btn" onClick={() => session.cancel()}>
            Stop
          </button>
        ) : (
          <button className="vd-ai-btn vd-ai-primary" onClick={send}>
            Send
          </button>
        )}
        <button className="vd-ai-btn" onClick={() => session.clear()} disabled={!s.answer && !s.error && s.history.length === 0}>
          Clear
        </button>
        <label className="vd-ai-check">
          <input type="checkbox" checked={showSent} onChange={(e) => setShowSent(e.target.checked)} />
          Show what is sent
        </label>
      </div>

      {showSent ? (
        <div className="vd-ai-sent" aria-label="What is sent">
          <div className="vd-ai-sent-title">
            Sent to {s.via || "the model"}
            {ctxSummary ? ` (${ctxSummary})` : ""}
          </div>
          <pre>{`Instructions:\n${SYSTEM[s.task]}\n\nMessage:\n${sent || "(nothing yet)"}`}</pre>
        </div>
      ) : null}

      {s.error ? (
        <p className="vd-ai-error" role="alert">
          {s.error}
        </p>
      ) : null}

      {s.answer || running ? (
        <div className="vd-ai-answer" aria-live="polite" aria-busy={running}>
          <pre>{s.answer || "Waiting for the answer…"}</pre>
          {!running && s.answer ? (
            <div className="vd-ai-row">
              <button className="vd-ai-btn" onClick={() => void navigator.clipboard.writeText(s.answer)}>
                Copy
              </button>
              {s.task === "diagram" ? (
                <button className="vd-ai-btn vd-ai-primary" onClick={() => void session.draw()}>
                  Draw it
                </button>
              ) : null}
              {s.drawn !== null ? <span className="vd-ai-via">Drew {s.drawn} shapes. Undo with Cmd+Z.</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="vd-ai-key" ref={keyDetails}>
        <summary>Key and provider</summary>
        <p className="vd-ai-note">
          {s.hasKey ? "A key is saved on this computer." : "No key is saved."} It is kept outside your config and
          your vault, and the app cannot show it again. Provider, model and address are in Settings, Plugins, AI assistant.
        </p>
        <div className="vd-ai-row">
          <input
            ref={keyBox}
            type="password"
            className="vd-ai-keyinput"
            aria-label="API key"
            placeholder="Paste your API key"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim()) {
                void session.setKey(key).then(() => setKey(""));
              }
            }}
          />
          <button
            className="vd-ai-btn vd-ai-primary"
            disabled={!key.trim()}
            onClick={() => void session.setKey(key).then(() => setKey(""))}
          >
            Save key
          </button>
          {s.hasKey ? (
            <button className="vd-ai-btn" onClick={() => void session.removeKey()}>
              Remove key
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
