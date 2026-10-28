import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getPluginsState,
  installRegistryPlugin,
  subscribePluginsState,
  uninstallPlugin,
} from "../plugins/host/manage";
import { permissionText } from "../plugins/host/permissions";
import {
  getRegistryBackend,
  loadRegistry,
  registryStatus,
  searchRegistry,
} from "../plugins/registry/client";
import { toInstallError } from "../theme/install/types";
import {
  consentText,
  grantConsent,
  hasConsent,
} from "../theme/install/consent";
import { toastStore } from "../toasts/toastStore";
import { getPreferences } from "../vault/preferences";

import { ConfirmModal } from "./ConfirmModal";
import { keyBelongsToControl } from "./keyTarget";
import { Dialog } from "./Dialog";

import "./pluginBrowser.css";

import type {
  CatalogueBackend,
  LoadedCatalogue,
} from "../theme/catalogue/types";
import type { RegistryEntry } from "../plugins/registry/types";

type Phase =
  | { k: "consent" }
  | { k: "loading" }
  | { k: "error"; message: string }
  | { k: "ready" };

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const optionId = (e: RegistryEntry) => `vault-pb-${e.id}`;

interface Props {
  /** Fetch the list even when the cache is fresh. */
  refresh?: boolean;
  onClose: () => void;
  win?: Window;
}

/** Settings, Plugins, Browse: the community plugins list with details, install, update and uninstall. */
export const PluginBrowserDialog = ({
  refresh = false,
  onClose,
  win = window,
}: Props) => {
  const prefs = getPreferences(win);
  const [phase, setPhase] = useState<Phase>(
    hasConsent("networkAllowPlugins", win)
      ? { k: "loading" }
      : { k: "consent" },
  );
  const [loaded, setLoaded] = useState<LoadedCatalogue<RegistryEntry> | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<RegistryEntry | null>(
    null,
  );
  const search = useRef<HTMLInputElement>(null);
  const backend = useRef<CatalogueBackend | null>(null);
  const forceNext = useRef(refresh);
  const started = useRef(false);
  const state = useSyncExternalStore(subscribePluginsState, getPluginsState);
  const versions = useMemo(
    () => new Map(state.plugins.map((p) => [p.id, p.version])),
    [state.plugins],
  );

  const open = useCallback(async () => {
    setPhase({ k: "loading" });
    setError(null);
    try {
      const p = getPreferences(win);
      const b = (backend.current ??= await getRegistryBackend(win));
      const list = await loadRegistry(b, {
        url: p.pluginsRegistryUrl,
        ttlHours: p.pluginsRegistryTtlHours,
        force: forceNext.current,
      });
      forceNext.current = false;
      setLoaded(list);
      setPhase({ k: "ready" });
    } catch (err) {
      const e = toInstallError(err);
      if (e.code === "NETWORK_NOT_ALLOWED" || e.code === "NETWORK_DISABLED") {
        setPhase({ k: "consent" });
      } else {
        setPhase({ k: "error", message: e.message });
      }
    }
  }, [win]);

  useEffect(() => {
    if (!started.current && phase.k === "loading") {
      started.current = true;
      void open();
    }
  }, [phase.k, open]);

  useEffect(() => {
    if (phase.k === "ready") {
      search.current?.focus();
    }
  }, [phase.k]);

  const entries = loaded?.catalogue.entries;
  const shown = useMemo(
    () => (entries ? searchRegistry(entries, query) : []),
    [entries, query],
  );
  const current = shown.find((e) => e.id === selected) ?? shown[0] ?? null;

  const retry = (force: boolean) => {
    forceNext.current = force;
    started.current = false;
    setPhase({ k: "loading" });
  };

  const allow = async () => {
    if (await grantConsent("networkAllowPlugins", win)) {
      retry(false);
    }
  };

  const act = async (entry: RegistryEntry, update: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const info = await installRegistryPlugin(entry.id);
      toastStore.push({
        message:
          info.review.state === "ok"
            ? `${update ? "Updated" : "Installed"} ${info.name}${
                update ? "." : ". Enable it in the plugin list."
              }`
            : `${update ? "Updated" : "Installed"} ${
                info.name
              }. Review its permissions in the plugin list.`,
      });
    } catch (err) {
      setError(toInstallError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: RegistryEntry) => {
    setConfirmRemove(null);
    setBusy(true);
    setError(null);
    try {
      await uninstallPlugin(entry.id);
      toastStore.push({ message: `Uninstalled ${entry.name}.` });
    } catch (err) {
      setError(toInstallError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (by: number) => {
    if (shown.length === 0) {
      return;
    }
    const at = current ? shown.indexOf(current) : 0;
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + by))];
    setSelected(next.id);
    document
      .getElementById(optionId(next))
      ?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (
      e.key === "Enter" &&
      current &&
      !busy &&
      !keyBelongsToControl(e, search.current)
    ) {
      e.preventDefault();
      const status = registryStatus(current, versions.get(current.id));
      if (status !== "installed" && current.api === 0) {
        void act(current, status === "update");
      }
    }
  };

  const details = (e: RegistryEntry) => {
    const status = registryStatus(e, versions.get(e.id));
    const installedVersion = versions.get(e.id);
    const incompatible = e.api !== 0;
    return (
      <section className="vault-pb__details" aria-label={`${e.name} details`}>
        <h3>{e.name}</h3>
        <p className="vault-pb__meta">
          {[
            e.author && `by ${e.author}`,
            `version ${e.version}`,
            e.licence,
            e.size !== undefined && sizeText(e.size),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {e.description && <p>{e.description}</p>}
        {e.minApp && (
          <p className="vault-pb__meta">Needs Vaultdraw {e.minApp} or newer.</p>
        )}
        {e.homepage && <p className="vault-pb__meta">{e.homepage}</p>}
        <h4>Permissions</h4>
        {e.permissions.length === 0 ? (
          <p>None. It cannot read or change your vault.</p>
        ) : (
          <ul data-testid="plugin-browser-permissions">
            {e.permissions.map((p) => (
              <li key={p}>{permissionText(p)}</li>
            ))}
          </ul>
        )}
        {incompatible && (
          <p role="note">
            This plugin targets plugin API {e.api}, which this Vaultdraw does
            not run.
          </p>
        )}
        {installedVersion !== undefined && (
          <p className="vault-pb__meta">
            Installed: version {installedVersion}
          </p>
        )}
        <div className="vault-pb__actions">
          {status !== "installed" && (
            <button
              type="button"
              className="vault-btn vault-btn--primary"
              disabled={busy || incompatible}
              onClick={() => void act(e, status === "update")}
            >
              {status === "update" ? `Update to ${e.version}` : "Install"}
            </button>
          )}
          {status !== "available" && (
            <button
              type="button"
              className="vault-btn"
              disabled={busy}
              onClick={() => setConfirmRemove(e)}
            >
              Uninstall
            </button>
          )}
        </div>
      </section>
    );
  };

  const body = (() => {
    switch (phase.k) {
      case "consent":
        return (
          <p data-testid="plugin-browser-consent">
            {consentText(prefs.networkEnabled, prefs.networkAllowPlugins)
              .replace("a theme", "a plugin list and plugins")
              .replace(/theme downloads/g, "plugin downloads")}
          </p>
        );
      case "loading":
        return (
          <p role="status" data-testid="plugin-browser-loading">
            Loading the plugins list…
          </p>
        );
      case "error":
        return (
          <div role="alert" className="vault-error-text">
            {phase.message}
          </div>
        );
      case "ready":
        break;
    }
    return (
      <div className="vault-pb" onKeyDown={onKeyDown}>
        {loaded?.notice && (
          <p className="vault-pb__meta" role="status">
            Showing the saved list: {loaded.notice}
          </p>
        )}
        <input
          ref={search}
          className="vault-input"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="vault-pb-list"
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-label="Search plugins"
          placeholder="Search plugins (name, author, description)"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {shown.length === 0 ? (
          <p className="vault-pb__meta" data-testid="plugin-browser-empty">
            {entries?.length === 0
              ? "The list has no plugins yet."
              : "No plugin matches. Try fewer words."}
          </p>
        ) : (
          <div className="vault-pb__body">
            <ul
              id="vault-pb-list"
              role="listbox"
              aria-label="Community plugins"
              className="vault-pb__list"
            >
              {shown.map((e) => {
                const status = registryStatus(e, versions.get(e.id));
                return (
                  <li
                    key={e.id}
                    id={optionId(e)}
                    role="option"
                    aria-selected={e.id === current?.id}
                    className={`vault-pb__item${
                      e.id === current?.id ? " is-current" : ""
                    }`}
                    onClick={() => setSelected(e.id)}
                  >
                    <span className="vault-pb__name">{e.name}</span>
                    <span className="vault-pb__meta">
                      {e.author} · {e.version}
                    </span>
                    {status !== "available" && (
                      <span className="vault-pb__badge">
                        {status === "update" ? "Update" : "Installed"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {current && details(current)}
          </div>
        )}
        {error && (
          <div role="alert" className="vault-error-text">
            {error}
          </div>
        )}
        <p className="vault-pb__meta">
          Up and Down move, Enter installs or updates. Nothing runs until you
          enable it in the plugin list.
        </p>
      </div>
    );
  })();

  const close = (label = "Close") => (
    <button
      type="button"
      className="vault-btn"
      onClick={onClose}
      disabled={phase.k === "loading"}
    >
      {label}
    </button>
  );
  const footer =
    phase.k === "consent" ? (
      <>
        {close("Not now")}
        <button
          type="button"
          className="vault-btn vault-btn--primary"
          onClick={() => void allow()}
        >
          Allow
        </button>
      </>
    ) : phase.k === "error" ? (
      <>
        {close()}
        <button
          type="button"
          className="vault-btn vault-btn--primary"
          onClick={() => retry(true)}
        >
          Try again
        </button>
      </>
    ) : phase.k === "ready" ? (
      <>
        <button
          type="button"
          className="vault-btn"
          disabled={busy}
          onClick={() => retry(true)}
        >
          Refresh list
        </button>
        {close()}
      </>
    ) : (
      close()
    );

  return (
    <>
      <Dialog
        title="Community plugins"
        titleId="plugin-browser-title"
        testId="plugin-browser-dialog"
        className="vd-dialog--wide vault-pb-dialog"
        onClose={onClose}
        busy={busy}
        footer={footer}
      >
        {body}
      </Dialog>
      {confirmRemove && (
        <ConfirmModal
          title={`Uninstall ${confirmRemove.name}?`}
          message={`This deletes the ${confirmRemove.name} folder and its files.`}
          confirmLabel="Uninstall"
          isDanger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => void remove(confirmRemove)}
        />
      )}
    </>
  );
};
