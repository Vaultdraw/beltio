import { useEffect, useMemo, useRef, useState } from "react";

import { getInstallBackend } from "../theme/install/backends";
import {
  applyUpdate,
  checkUpdates,
  freeName,
  installCandidate,
  kibToBytes,
  validateCandidate,
} from "../theme/install/installer";
import {
  blockReason,
  hasThemeConsent,
  unblockLabel,
  unblockThemes,
} from "../theme/install/consent";
import { toInstallError } from "../theme/install/types";
import { reloadThemeRegistry } from "../theme/registry";
import { getPreferences, updatePreferences } from "../vault/preferences";

import { Dialog } from "./Dialog";

import type { UpdateStatus, Candidate } from "../theme/install/installer";
import type { InstallDialogRequest } from "../theme/install/installStore";
import type {
  InstallBackend,
  InstalledTheme,
  RepoTheme,
  Resolved,
} from "../theme/install/types";

type Step =
  | { k: "blocked" }
  | { k: "input" }
  | { k: "busy"; text: string }
  | { k: "pick"; repo: Extract<Resolved, { kind: "repo" }>; preselect?: string }
  | { k: "confirm"; cand: Candidate; name: string }
  | { k: "clash"; cand: Candidate; name: string }
  | { k: "done"; name: string }
  | { k: "list" };

const MAX_ROWS = 200;

interface Props {
  request: InstallDialogRequest;
  onClose: () => void;
  /** Called after "Use it" changed the selected theme (re-reads appearance). */
  onThemeChanged?: () => void;
  win?: Window;
}

export const ThemeInstallDialog = ({
  request,
  onClose,
  onThemeChanged,
  win = window,
}: Props) => {
  const prefs = getPreferences(win);
  const needsNetwork = request.mode !== "uninstall";
  const consented = hasThemeConsent(win);
  const [step, setStep] = useState<Step>(
    needsNetwork && !consented ? { k: "blocked" } : startStep(request),
  );
  const [input, setInput] = useState(
    request.mode === "install" ? request.input ?? "" : "",
  );
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledTheme[]>([]);
  const [updates, setUpdates] = useState<Record<string, UpdateStatus>>({});
  const backendRef = useRef<InstallBackend | null>(null);
  const maxBytes = kibToBytes(prefs.themeInstallMaxKb);

  const backend = async () =>
    (backendRef.current ??= await getInstallBackend(win));

  const fail = (err: unknown) => setError(toInstallError(err).message);

  const run = async (text: string, work: () => Promise<Step | void>) => {
    setError(null);
    const before = step;
    setStep({ k: "busy", text });
    try {
      const next = await work();
      setStep(next ?? before);
    } catch (err) {
      setError(toInstallError(err).message);
      setStep(before.k === "blocked" ? { k: "input" } : before);
    }
  };

  const fetchRepo = async (
    repo: Extract<Resolved, { kind: "repo" }>,
    theme: RepoTheme,
  ): Promise<Step> => {
    const got = await (
      await backend()
    ).fetch(
      {
        kind: "repo",
        owner: repo.owner,
        repo: repo.repo,
        commit: repo.commit,
        path: theme.path,
      },
      maxBytes,
    );
    const cand: Candidate = {
      json: got.json,
      fallbackName: theme.name,
      source: {
        repo: `${repo.owner}/${repo.repo}`,
        path: theme.path,
        commit: repo.commit,
        ref: repo.ref,
        sha256: got.sha256,
        url: got.url,
      },
    };
    return {
      k: "confirm",
      cand,
      name: validateCandidate(cand.json, theme.name),
    };
  };

  const toCandidate = async (resolved: Resolved): Promise<Step> => {
    if (resolved.kind === "file") {
      const cand: Candidate = {
        json: resolved.json,
        fallbackName: resolved.name,
        source: { url: resolved.url, sha256: resolved.sha256 },
      };
      return {
        k: "confirm",
        cand,
        name: validateCandidate(cand.json, cand.fallbackName),
      };
    }
    const wanted = pickName(request)?.toLowerCase();
    const match = wanted
      ? resolved.themes.find((t) => t.name.toLowerCase() === wanted)
      : undefined;
    return match
      ? fetchRepo(resolved, match)
      : { k: "pick", repo: resolved, preselect: pickName(request) };
  };

  const resolveInput = (text: string) =>
    run("Looking it up…", async () =>
      toCandidate(await (await backend()).resolve(text.trim(), maxBytes)),
    );

  const fetchRepoTheme = (
    repo: Extract<Resolved, { kind: "repo" }>,
    theme: RepoTheme,
  ) => run(`Downloading ${theme.name}...`, () => fetchRepo(repo, theme));

  const install = (
    cand: Candidate,
    name: string,
    options: { replace?: boolean; asName?: string } = {},
  ) =>
    run(`Installing ${name}...`, async () => {
      try {
        const done = await installCandidate(await backend(), cand, options);
        await reloadThemeRegistry(win);
        return { k: "done", name: done };
      } catch (err) {
        if (toInstallError(err).code === "THEME_EXISTS" && !options.replace) {
          setInstalled(await (await backend()).installed());
          return { k: "clash", cand, name };
        }
        throw err;
      }
    });

  const allow = async () => {
    if (await unblockThemes(win)) {
      setStep(startStep(request));
    }
  };

  // Update / uninstall: load the list; update also checks for newer files.
  const listLoaded = useRef(false);
  useEffect(() => {
    if (step.k !== "list" || listLoaded.current) {
      return;
    }
    listLoaded.current = true;
    let live = true;
    void (async () => {
      try {
        const b = await backend();
        const list = await b.installed();
        if (!live) {
          return;
        }
        setInstalled(list);
        if (request.mode === "update") {
          const results = await checkUpdates(b, list, maxBytes);
          if (live) {
            setUpdates(Object.fromEntries(results.map((r) => [r.name, r])));
          }
        }
      } catch (err) {
        if (live) {
          fail(err);
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.k]);

  // A pre-filled address (the "no longer built in" notice) is looked up at once.
  const autoLookup = useRef(request.mode === "install" && !!request.input);
  useEffect(() => {
    if (step.k === "input" && autoLookup.current) {
      autoLookup.current = false;
      void resolveInput(input);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.k]);

  const removeTheme = (name: string) =>
    run(`Removing ${name}...`, async () => {
      await (await backend()).uninstall(name);
      await reloadThemeRegistry(win);
      setInstalled((list) => list.filter((t) => t.name !== name));
      return { k: "list" };
    });

  const updateTheme = (theme: InstalledTheme, status: UpdateStatus) =>
    run(`Updating ${theme.name}...`, async () => {
      if (status.state === "newer") {
        await applyUpdate(await backend(), theme, status.fetched);
        await reloadThemeRegistry(win);
        setUpdates((u) => ({
          ...u,
          [theme.name]: { name: theme.name, state: "current" },
        }));
      }
      return { k: "list" };
    });

  const title =
    request.mode === "install"
      ? "Install a theme"
      : request.mode === "update"
      ? "Update installed themes"
      : "Remove installed themes";

  const repoThemes = useMemo(() => {
    if (step.k !== "pick") {
      return [];
    }
    const q = filter.trim().toLowerCase();
    return step.repo.themes.filter((t) => t.name.toLowerCase().includes(q));
  }, [step, filter]);

  const busy = step.k === "busy";
  const body = (() => {
    switch (step.k) {
      case "blocked":
        return (
          <p data-testid="theme-install-offline">
            {blockReason("networkAllowThemes", win)}
          </p>
        );
      case "input":
        return (
          <div className="vault-field">
            <label htmlFor="theme-install-input">Address or GitHub repo</label>
            <input
              id="theme-install-input"
              className="vault-input"
              type="text"
              autoFocus
              spellCheck={false}
              placeholder="https://example.com/My-Theme.json or owner/repo"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
            />
            <span className="vd-dialog__hint">
              A theme file (.json), or a GitHub repo to pick from. The default
              repo is Vaultdraw/themes.
            </span>
          </div>
        );
      case "busy":
        return <p role="status">{step.text}</p>;
      case "pick":
        return (
          <div className="vault-field">
            <label htmlFor="theme-install-filter">
              {step.repo.owner}/{step.repo.repo}: {step.repo.themes.length}{" "}
              themes
            </label>
            <input
              id="theme-install-filter"
              className="vault-input vd-move__filter"
              type="text"
              autoFocus
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="vd-move__tree" role="listbox" aria-label="Themes">
              {repoThemes.slice(0, MAX_ROWS).map((t) => (
                <div
                  key={t.path}
                  role="option"
                  aria-selected={t.name === step.preselect}
                  tabIndex={0}
                  className="vd-move__row"
                  onClick={() => void fetchRepoTheme(step.repo, t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void fetchRepoTheme(step.repo, t);
                    }
                  }}
                >
                  <span className="vd-move__name">{t.name}</span>
                </div>
              ))}
              {repoThemes.length === 0 && (
                <div className="vd-move__empty">No theme matches.</div>
              )}
            </div>
          </div>
        );
      case "confirm":
        return (
          <p>
            Install <strong>{step.name}</strong> from{" "}
            <code>{sourceLabel(step.cand)}</code>? It is a colour palette; it
            has no code.
          </p>
        );
      case "clash":
        return (
          <p>
            A theme named <strong>{step.name}</strong> is already installed.
            Replace it, or keep both?
          </p>
        );
      case "done":
        return (
          <p role="status" data-testid="theme-install-done">
            Installed <strong>{step.name}</strong>.
          </p>
        );
      case "list":
        return installed.length === 0 ? (
          <p>No installed themes. Themes you add yourself are not listed.</p>
        ) : (
          <div className="vd-move__tree" aria-label="Installed themes">
            {installed.map((t) => {
              const status = updates[t.name];
              return (
                <div key={t.name} className="vd-move__row">
                  <span className="vd-move__name">{t.name}</span>
                  {request.mode === "update" ? (
                    status?.state === "newer" ? (
                      <button
                        type="button"
                        className="vault-btn vault-btn--sm"
                        onClick={() => void updateTheme(t, status)}
                      >
                        Update
                      </button>
                    ) : (
                      <span className="vd-dialog__hint">
                        {status?.state === "failed"
                          ? status.message
                          : status
                          ? "Up to date"
                          : "Checking…"}
                      </span>
                    )
                  ) : (
                    <button
                      type="button"
                      className="vault-btn vault-btn--sm"
                      onClick={() => void removeTheme(t.name)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
    }
  })();

  const footer = (() => {
    const cancel = (label = "Cancel") => (
      <button
        type="button"
        className="vault-btn"
        onClick={onClose}
        disabled={busy}
      >
        {label}
      </button>
    );
    switch (step.k) {
      case "blocked":
        return (
          <>
            {cancel("Not now")}
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => void allow()}
            >
              {unblockLabel(win)}
            </button>
          </>
        );
      case "input":
        return (
          <>
            {cancel()}
            <button
              type="submit"
              className="vault-btn vault-btn--primary"
              disabled={!input.trim()}
            >
              Look up
            </button>
          </>
        );
      case "confirm":
        return (
          <>
            {cancel()}
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => void install(step.cand, step.name)}
            >
              Install
            </button>
          </>
        );
      case "clash":
        return (
          <>
            {cancel()}
            <button
              type="button"
              className="vault-btn"
              onClick={() =>
                void install(step.cand, step.name, {
                  asName: freeName(
                    step.name,
                    installed.map((t) => t.name),
                  ),
                })
              }
            >
              Keep both
            </button>
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() =>
                void install(step.cand, step.name, { replace: true })
              }
            >
              Replace
            </button>
          </>
        );
      case "done":
        return (
          <>
            {cancel("Close")}
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              onClick={() => {
                updatePreferences({ colorTheme: step.name }, win);
                onThemeChanged?.();
                onClose();
              }}
            >
              Use it
            </button>
          </>
        );
      default:
        return cancel("Close");
    }
  })();

  return (
    <Dialog
      title={title}
      titleId="theme-install-title"
      testId="theme-install-dialog"
      onClose={onClose}
      busy={busy}
      onSubmit={
        step.k === "input"
          ? (e) => {
              e.preventDefault();
              void resolveInput(input);
            }
          : undefined
      }
      footer={footer}
    >
      {body}
      {error && (
        <div className="vault-error-text" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
};

function startStep(request: InstallDialogRequest): Step {
  return request.mode === "install" ? { k: "input" } : { k: "list" };
}

const pickName = (request: InstallDialogRequest) =>
  request.mode === "install" ? request.pick : undefined;

const sourceLabel = (cand: Candidate) =>
  cand.source.repo
    ? `${cand.source.repo}/${cand.source.path ?? ""}`
    : cand.source.url ?? "";
