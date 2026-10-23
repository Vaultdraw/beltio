import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getSnippetsState,
  openSnippetsDir,
  reloadSnippets,
  subscribeSnippets,
  toggleSnippet,
} from "../../../snippets/store";
import { IconFolder, IconRefresh } from "../../Icons";
import { SettingRow } from "../SettingRow";
import { useSettings } from "../SettingsContext";

import { Switch } from "./controls";

import "./snippets.css";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Settings → Appearance → CSS snippets: one switch per `snippets/*.css`. */
export const SnippetsSetting = () => {
  const { win } = useSettings();
  const doc = win?.document ?? null;
  const state = useSyncExternalStore(subscribeSnippets, getSnippetsState);
  const [error, setError] = useState<string | null>(null);

  // Opening the page re-lists the folder, like Obsidian's snippet list.
  useEffect(() => {
    if (doc && win) {
      void reloadSnippets(doc, win);
    }
  }, [doc, win]);

  const run = async (action: () => Promise<void>, what: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(`Could not ${what}: ${errorText(err)}`);
    }
  };

  const problems = [
    ...(state.loadError ? [state.loadError] : []),
    ...state.missing.map((name) => `${name}.css is enabled but not found`),
    ...(error ? [error] : []),
  ];

  return (
    <SettingRow
      id="css-snippets"
      layout="stacked"
      testId="settings-snippets"
      aside={
        <span className="vault-snippets__actions">
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={() =>
              void run(() => openSnippetsDir(win), "open the snippets folder")
            }
          >
            <IconFolder />
            <span>Open folder</span>
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={() =>
              doc &&
              win &&
              void run(() => reloadSnippets(doc, win), "reload the snippets")
            }
          >
            <IconRefresh />
            <span>Reload</span>
          </button>
        </span>
      }
      details={
        problems.length > 0 && (
          <ul className="vault-theme-problems" aria-label="Snippet problems">
            {problems.map((p) => (
              <li
                key={p}
                className="vault-theme-problems__item vault-theme-problems__item--error"
              >
                {p}
              </li>
            ))}
          </ul>
        )
      }
    >
      {state.loaded && state.snippets.length === 0 ? (
        <p className="vault-snippets__empty">
          No snippets yet. Put <code>.css</code> files in the snippets folder.
        </p>
      ) : (
        <ul className="vault-snippets" aria-label="CSS snippets">
          {state.snippets.map((s) => (
            <li key={s.id} className="vault-snippets__item" title={s.path}>
              <span className="vault-snippets__name">{s.id}</span>
              {s.error && (
                <span className="vault-snippets__error" role="status">
                  {s.error}
                </span>
              )}
              <Switch
                checked={s.enabled}
                label={`Enable snippet ${s.id}`}
                onChange={(on) =>
                  doc &&
                  win &&
                  void run(
                    () => toggleSnippet(doc, win, s.id, on),
                    `toggle ${s.id}`,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SettingRow>
  );
};
