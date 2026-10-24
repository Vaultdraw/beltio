import { useId, useState } from "react";

import { permissionText } from "../../../plugins/host/permissions";
import { DeclaredSettingsPage } from "../declared/DeclaredSettingsPage";

import { Switch } from "./controls";

import type { PluginCost } from "../../../plugins/host/cost";
import type { PluginInfo } from "../../../plugins/host/types";

/** Activation slower than this gets a "slow" badge. */
export const SLOW_ACTIVATION_MS = 100;

export type RuntimeState =
  | "idle"
  | "loading"
  | "active"
  | "failed"
  | "disabled";

const RUNTIME_LABEL: Record<RuntimeState, string> = {
  idle: "Not loaded",
  loading: "Loading",
  active: "Active",
  failed: "Failed to load",
  disabled: "Not loaded",
};

const formatMb = (bytes: number) =>
  bytes < 0.1 * 1024 * 1024 ? "<0.1" : (bytes / (1024 * 1024)).toFixed(1);

/** Why the switch is off the table, or null. */
export const blockedReason = (info: PluginInfo): string | null =>
  !info.compatible
    ? info.problem ??
      (info.minApp ? `Needs app ≥ ${info.minApp}` : "Incompatible")
    : null;

export interface PluginRowProps {
  info: PluginInfo;
  enabled: boolean;
  state: RuntimeState;
  cost?: PluginCost;
  onToggle: (next: boolean) => void;
  onReenable: () => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onUninstall: () => void;
  /** Opens the dialog that confirms the permissions an update added. */
  onReview: () => void;
  /** Size of its saved data (`ctx.storage`); undefined when it has none. */
  dataBytes?: number;
  /** Asks to delete its saved data. */
  onDeleteData?: () => void;
}

/** "12 KB" style size of saved data (at least 1 KB). */
export const formatDataSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const Badge = ({
  kind,
  children,
}: {
  kind: "warn" | "info" | "danger";
  children: string;
}) => (
  <span className="vault-plugin__badge" data-kind={kind}>
    {children}
  </span>
);

const CostLine = ({ cost }: { cost: PluginCost }) => {
  const slow = (cost.activateMs ?? 0) > SLOW_ACTIVATION_MS;
  const parts = [
    cost.activateMs !== null &&
      `Activated in ${Math.round(cost.activateMs)} ms`,
    cost.estimatedBytes > 0 &&
      `~${formatMb(cost.estimatedBytes)} MB (estimate)`,
  ].filter(Boolean);
  return (
    <span className="vault-plugin__cost">
      {parts.join(" · ")}
      {slow && <Badge kind="warn">slow</Badge>}
    </span>
  );
};

/** One installed plugin: facts, badges, the enable switch and actions. */
export const PluginRow = ({
  info,
  enabled,
  state,
  cost,
  onToggle,
  onReenable,
  onReload,
  onOpenFolder,
  onUninstall,
  onReview,
  dataBytes,
  onDeleteData,
}: PluginRowProps) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const blocked = blockedReason(info);
  const hasSettings = enabled && info.contributes.settings.length > 0;
  const bundled = info.source === "bundled";
  return (
    <li
      className="vault-plugin"
      data-testid={`plugin-${info.id}`}
      data-state={state}
      aria-label={info.name}
    >
      <div className="vault-plugin__main">
        <div className="vault-plugin__info">
          <div className="vault-plugin__title">
            <span className="vault-setting-label">{info.name}</span>
            <span className="vault-plugin__version">v{info.version}</span>
            {!bundled && <Badge kind="warn">Unverified</Badge>}
            {enabled && !info.hostDisabled && !blocked && (
              <Badge kind="info">{RUNTIME_LABEL[state]}</Badge>
            )}
          </div>
          {info.description && (
            <div className="vault-setting-desc">{info.description}</div>
          )}
          <div className="vault-plugin__meta">
            {bundled ? "Bundled" : "User plugin"}
            {info.author && ` · ${info.author}`}
            {cost &&
              enabled &&
              (cost.activateMs !== null || cost.estimatedBytes > 0) && (
                <>
                  {" "}
                  · <CostLine cost={cost} />
                </>
              )}
          </div>
          {info.permissions.length > 0 && (
            <div
              className="vault-plugin__meta"
              data-testid={`plugin-${info.id}-permissions`}
            >
              Says it can: {info.permissions.map(permissionText).join(", ")}
            </div>
          )}
          {info.review.state === "review" && (
            <div className="vault-plugin__problem" role="status">
              Needs review: new permission{" "}
              {info.review.added.map(permissionText).join(", ")}.{" "}
              <button
                type="button"
                className="vault-btn vault-btn--sm"
                aria-label={`Review ${info.name}`}
                onClick={onReview}
              >
                Review
              </button>
            </div>
          )}
          {blocked && (
            <div className="vault-plugin__problem" role="status">
              {blocked}
            </div>
          )}
          {info.hostDisabled && (
            <div className="vault-plugin__problem" role="status">
              Disabled by Vaultdraw: {info.hostDisabled}{" "}
              <button
                type="button"
                className="vault-btn vault-btn--sm"
                aria-label={`Re-enable ${info.name}`}
                onClick={onReenable}
              >
                Re-enable
              </button>
            </div>
          )}
        </div>
        <Switch
          checked={enabled}
          label={`Enable ${info.name}`}
          disabled={blocked !== null || info.hostDisabled !== null}
          onChange={onToggle}
        />
      </div>
      <div className="vault-plugin__actions">
        {hasSettings && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${info.name} settings`}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide settings" : "Settings"}
          </button>
        )}
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          aria-label={`Open folder of ${info.name}`}
          onClick={onOpenFolder}
        >
          Open folder
        </button>
        {(state === "active" || info.dev) && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            aria-label={`Reload ${info.name}`}
            onClick={onReload}
          >
            Reload
          </button>
        )}
        {dataBytes !== undefined && onDeleteData && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            aria-label={`Delete data of ${info.name} (${formatDataSize(
              dataBytes,
            )})`}
            data-plugin-delete-data={info.id}
            onClick={onDeleteData}
          >
            Delete data ({formatDataSize(dataBytes)})
          </button>
        )}
        {!bundled && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            aria-label={`Uninstall ${info.name}`}
            onClick={onUninstall}
          >
            Uninstall
          </button>
        )}
      </div>
      {hasSettings && open && (
        <div id={panelId} className="vault-plugin__settings">
          <DeclaredSettingsPage
            pluginId={info.id}
            title="Settings"
            scopeSwitch={false}
          />
        </div>
      )}
    </li>
  );
};
