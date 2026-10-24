import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { getPluginCosts } from "../../../plugins/host/cost";
import {
  clearHostDisabled,
  confirmPluginPermissions,
  deletePluginData,
  pluginDataSizes,
  getPluginsState,
  reloadPlugin,
  restartInSafeMode,
  revealPluginFolder,
  subscribePluginsState,
  uninstallPlugin,
  type PluginsState,
} from "../../../plugins/host/manage";
import { permissionText } from "../../../plugins/host/permissions";
import { runCommandById } from "../../../plugins/host/runner";
import { pluginHostStarted } from "../../../plugins/hostFlag";
import {
  installPluginFromFolder,
  reloadPluginList,
} from "../../../plugins/ui/pluginActions";
import { deleteDataRequest } from "../../../plugins/ui/pluginCommands";
import { subscribeStorageWrites } from "../../../plugins/host/storage";
import { toastStore } from "../../../toasts/toastStore";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../../vault/preferences";
import { ConfirmModal } from "../../ConfirmModal";
import { useSettings } from "../SettingsContext";

import { formatDataSize, PluginRow, type RuntimeState } from "./PluginRow";

import "./plugins.css";

import type { PluginInfo } from "../../../plugins/host/types";

type SafeMode = NonNullable<PluginsState["safeMode"]>;

/** Why Vaultdraw is in safe mode, as one sentence. */
export const safeModeText = (safe: SafeMode): string =>
  safe.reason === "crashes"
    ? `Vaultdraw started in safe mode after ${safe.crashedLaunches} crash${
        safe.crashedLaunches === 1 ? "" : "es"
      } with these plugins enabled: ${
        safe.pluginsAtCrash.join(", ") || "none"
      }.`
    : safe.reason === "modifier"
    ? "Vaultdraw started in safe mode because Option was held."
    : "Vaultdraw started in safe mode on request.";

export const SafeModeBanner = ({
  safe,
  onRestart,
}: {
  safe: SafeMode;
  onRestart: () => void;
}) => (
  <div
    className="vault-plugins__safe"
    role="alert"
    data-testid="plugins-safe-mode"
  >
    <p>{safeModeText(safe)} Plugins are not loaded.</p>
    <button
      type="button"
      className="vault-btn vault-btn--sm"
      onClick={onRestart}
    >
      Restart normally
    </button>
  </div>
);

const useEnabledIds = (): string[] => {
  const { win } = useSettings();
  const key = useSyncExternalStore(subscribePreferences, () =>
    JSON.stringify(getPreferences(win).pluginsEnabled),
  );
  return useMemo(() => JSON.parse(key) as string[], [key]);
};

const useManageState = (): PluginsState =>
  useSyncExternalStore(subscribePluginsState, getPluginsState);

const report = (what: string, e: unknown) =>
  toastStore.push({
    message: `${what}: ${e instanceof Error ? e.message : String(e)}`,
    kind: "error",
  });

const run = (what: string, fn: () => Promise<unknown>) =>
  void fn().catch((e) => report(what, e));

const LIMIT_NOTE =
  "Permissions are what a plugin says it does, not a limit: plugins run with full access to your drawings and files.";

/** The enable dialog text; with no permissions it keeps the plain warning. */
const consentMessage = (info: PluginInfo): string =>
  info.permissions.length === 0
    ? `${info.name} is not reviewed by Vaultdraw. Plugins run with full access to your drawings and files. Enable?`
    : `${info.name} is not reviewed by Vaultdraw. ${LIMIT_NOTE} It says it can:`;

type Pending =
  | { kind: "enable"; info: PluginInfo }
  | { kind: "review"; info: PluginInfo }
  | { kind: "uninstall"; info: PluginInfo }
  | { kind: "deleteData"; info: PluginInfo; bytes: number }
  | null;

/** Saved data sizes by plugin id; read when the page opens and after a delete. */
const useDataSizes = (): [Map<string, number> | null, () => Promise<void>] => {
  const [sizes, setSizes] = useState<Map<string, number> | null>(null);
  const refresh = useCallback(
    () =>
      pluginDataSizes().then(setSizes, () => {
        // No sizes: the page still works, it only shows no "Delete data" buttons.
        setSizes(new Map());
      }),
    [],
  );
  useEffect(() => {
    void refresh();
    // A plugin that saves (or data deleted elsewhere) while the page is open.
    return subscribeStorageWrites(() => void refresh());
  }, [refresh]);
  return [sizes, refresh];
};

export const PluginsPage = () => {
  const { win } = useSettings();
  const state = useManageState();
  const enabledIds = useEnabledIds();
  const [pending, setPending] = useState<Pending>(null);
  const [dataSizes, refreshDataSizes] = useDataSizes();
  const rootRef = useRef<HTMLDivElement>(null);
  const dataRequest = useSyncExternalStore(
    deleteDataRequest.subscribe,
    deleteDataRequest.get,
  );
  // Opened by "Plugins: Delete data of a plugin…": focus the first "Delete data" button.
  useEffect(() => {
    if (!dataSizes || !deleteDataRequest.take()) {
      return;
    }
    const first = rootRef.current?.querySelector<HTMLButtonElement>(
      "[data-plugin-delete-data]",
    );
    if (first) {
      first.focus();
    } else {
      toastStore.push({ message: "No plugin has saved data." });
    }
  }, [dataRequest, dataSizes]);
  const installed = new Set(state.plugins.map((p) => p.id));
  const orphanData = [...(dataSizes ?? [])].filter(
    ([id]) => !installed.has(id),
  );

  // With no plugin enabled the host (and its list) starts on first visit.
  useEffect(() => {
    if (!pluginHostStarted.get()) {
      void reloadPluginList();
    }
  }, []);
  const costs = useMemo(
    () => new Map(getPluginCosts().map((c) => [c.id, c])),
    // Costs change when a plugin's runtime state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  const setEnabled = (id: string, on: boolean) =>
    updatePreferences(
      {
        pluginsEnabled: on
          ? [...new Set([...enabledIds, id])]
          : enabledIds.filter((x) => x !== id),
      },
      win,
    );

  const toggle = (info: PluginInfo, on: boolean) =>
    on && info.source !== "bundled"
      ? setPending({ kind: "enable", info })
      : setEnabled(info.id, on);

  /** Records what the plugin declares, then runs `then`. */
  const confirmThen = (info: PluginInfo, then: () => void) => {
    setPending(null);
    if (info.permissions.length === 0) {
      then();
      return;
    }
    run(`Could not save your choice for ${info.name}`, async () => {
      await confirmPluginPermissions(info.id, info.permissions);
      then();
    });
  };

  const uninstall = (info: PluginInfo) => {
    setEnabled(info.id, false);
    run(`Could not uninstall ${info.name}`, () => uninstallPlugin(info.id));
  };

  return (
    <div className="vault-plugins" data-testid="plugins-page" ref={rootRef}>
      {state.safeMode && (
        <SafeModeBanner
          safe={state.safeMode}
          onRestart={() =>
            run("Could not restart", () =>
              runCommandById("plugins.restartNormally"),
            )
          }
        />
      )}
      <div className="vault-plugins__toolbar">
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void installPluginFromFolder()}
        >
          Install from folder…
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => void reloadPluginList()}
        >
          Reload list
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--sm"
          onClick={() => run("Could not restart", () => restartInSafeMode())}
        >
          Restart in safe mode
        </button>
      </div>

      {state.plugins.length === 0 ? (
        <p className="vault-settings-empty">
          No plugins installed. Put a plugin folder in the plugins folder, or
          use Install from folder…
        </p>
      ) : (
        <ul className="vault-plugins__list" aria-label="Installed plugins">
          {state.plugins.map((info) => (
            <PluginRow
              key={info.id}
              info={info}
              enabled={enabledIds.includes(info.id)}
              state={(state.runtime[info.id]?.state ?? "idle") as RuntimeState}
              cost={costs.get(info.id)}
              onToggle={(on) => toggle(info, on)}
              onReenable={() =>
                run(`Could not re-enable ${info.name}`, () =>
                  clearHostDisabled(info.id),
                )
              }
              onReload={() =>
                run(`Could not reload ${info.name}`, () =>
                  reloadPlugin(info.id),
                )
              }
              onOpenFolder={() =>
                run("Could not open the folder", () =>
                  revealPluginFolder(info.dir),
                )
              }
              onReview={() => setPending({ kind: "review", info })}
              onUninstall={() => setPending({ kind: "uninstall", info })}
              dataBytes={dataSizes?.get(info.id)}
              onDeleteData={() =>
                setPending({
                  kind: "deleteData",
                  info,
                  bytes: dataSizes?.get(info.id) ?? 0,
                })
              }
            />
          ))}
        </ul>
      )}

      {orphanData.length > 0 && (
        <section
          aria-label="Saved data of removed plugins"
          className="vault-plugins__errors"
        >
          <h3 className="vault-settings-heading">
            Saved data of removed plugins
          </h3>
          <ul>
            {orphanData.map(([id, bytes]) => (
              <li key={id}>
                <code>{id}</code> ({formatDataSize(bytes)}){" "}
                <button
                  type="button"
                  className="vault-btn vault-btn--ghost vault-btn--sm"
                  aria-label={`Delete data of ${id} (${formatDataSize(bytes)})`}
                  data-plugin-delete-data={id}
                  onClick={() =>
                    setPending({
                      kind: "deleteData",
                      info: { id, name: id } as PluginInfo,
                      bytes,
                    })
                  }
                >
                  Delete data
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.errors.length > 0 && (
        <section aria-label="Broken plugins" className="vault-plugins__errors">
          <h3 className="vault-settings-heading">Could not be read</h3>
          <ul>
            {state.errors.map((e) => (
              <li key={e.dir}>
                <code>{e.dir}</code>: {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending?.kind === "enable" && (
        <ConfirmModal
          title={`Enable ${pending.info.name}?`}
          message={consentMessage(pending.info)}
          details={pending.info.permissions.map(permissionText)}
          confirmLabel="Enable"
          onCancel={() => setPending(null)}
          onConfirm={() =>
            confirmThen(pending.info, () => setEnabled(pending.info.id, true))
          }
        />
      )}
      {pending?.kind === "review" && (
        <ConfirmModal
          title={`${pending.info.name} wants new permissions`}
          message={`An update of ${pending.info.name} asks for more than you agreed to, so it is switched off. ${LIMIT_NOTE} It now says it can:`}
          details={pending.info.permissions.map(permissionText)}
          confirmLabel="Allow"
          onCancel={() => setPending(null)}
          onConfirm={() => confirmThen(pending.info, () => {})}
        />
      )}
      {pending?.kind === "uninstall" && (
        <ConfirmModal
          title={`Uninstall ${pending.info.name}?`}
          message={`This deletes the ${pending.info.name} folder and its files.`}
          confirmLabel="Uninstall"
          isDanger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            uninstall(pending.info);
            setPending(null);
          }}
        />
      )}
      {pending?.kind === "deleteData" && (
        <ConfirmModal
          title={`Delete the data of ${pending.info.name}?`}
          message={`This deletes what ${
            pending.info.name
          } saved (${formatDataSize(
            pending.bytes,
          )}). Its settings in config.toml stay. This cannot be undone.`}
          confirmLabel="Delete data"
          isDanger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { info } = pending;
            setPending(null);
            run(`Could not delete the data of ${info.name}`, async () => {
              await deletePluginData(info.id);
              await refreshDataSizes();
              toastStore.push({ message: `Deleted the data of ${info.name}.` });
            });
          }}
        />
      )}
    </div>
  );
};
