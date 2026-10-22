import { Fragment } from "react";

import { WELCOME_LINKS } from "../help/aboutLinks";
import { HELP_LINK_HANDLERS } from "../help/helpCommands";
import { isTauriAvailable } from "../vault/DesktopVaultRepository";

import { IconAlert, IconClose, IconFolder, IconPlus } from "./Icons";

import "./home.css";

interface OnboardingProps {
  recentVaults: readonly string[];
  lastVaultPath?: string | null;
  onOpenVault: () => void | Promise<void>;
  onCreateVault: () => void | Promise<void>;
  onSelectRecent: (vaultPath: string) => void | Promise<void>;
  onRemoveRecent: (vaultPath: string) => void;
  error?: string | null;
  loading?: boolean;
  ownerWindow?: Window | null;
}

export const Onboarding = ({
  recentVaults,
  lastVaultPath,
  onOpenVault,
  onCreateVault,
  onSelectRecent,
  onRemoveRecent,
  error,
  loading = false,
  ownerWindow,
}: OnboardingProps) => {
  const tauriActive = isTauriAvailable(ownerWindow);

  return (
    <div className="vault-onboarding">
      {/* Empty title-bar strip so the window can be dragged before a vault opens. */}
      <div className="vault-titlebar-drag" data-tauri-drag-region />
      <div className="vault-onboarding__card">
        <div className="vault-onboarding__logo" aria-hidden="true" />
        <h1 className="vault-onboarding__title" aria-label="Vaultdraw">
          vault<span className="vault-onboarding__title-accent">draw</span>
        </h1>
        <p className="vault-onboarding__desc">
          A vault is just a folder: your drawings are plain files on your disk,
          readable without Vaultdraw.
        </p>

        {!tauriActive && (
          <div className="vault-banner vault-banner--warning vault-onboarding__alert">
            <span className="vault-onboarding__alert-icon">
              <IconAlert />
            </span>
            <div>
              <strong>Web Browser Preview Notice</strong>
              <div className="vault-onboarding__alert-note">
                Tauri desktop backend is not active in this browser tab. Native
                filesystem folders, atomic saving, and background watching
                require running inside the Vaultdraw desktop application.
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="vault-banner vault-banner--warning vault-onboarding__alert vault-onboarding__alert--error">
            {error}
          </div>
        )}

        <div className="vault-onboarding__actions">
          <button
            type="button"
            className="vault-onboarding__option"
            aria-label="Create New Vault"
            aria-describedby="vault-onboarding-create"
            onClick={() => void onCreateVault()}
            disabled={loading}
          >
            <IconPlus width={18} height={18} />
            <span className="vault-onboarding__option-title">
              Create New Vault
            </span>
            <span
              id="vault-onboarding-create"
              className="vault-onboarding__option-desc"
            >
              Start with a new, empty folder.
            </span>
          </button>
          <button
            type="button"
            className="vault-onboarding__option"
            aria-label="Open Vault Folder"
            aria-describedby="vault-onboarding-open"
            onClick={() => void onOpenVault()}
            disabled={loading}
          >
            <IconFolder width={18} height={18} />
            <span className="vault-onboarding__option-title">
              Open Vault Folder
            </span>
            <span
              id="vault-onboarding-open"
              className="vault-onboarding__option-desc"
            >
              Use a folder of drawings you already have.
            </span>
          </button>
        </div>

        {recentVaults.length > 0 && (
          <div className="vault-onboarding__recent">
            <div className="vault-onboarding__recent-title">Recent Vaults</div>
            <div className="vault-onboarding__recent-list">
              {recentVaults.map((vaultPath) => (
                <div
                  key={vaultPath}
                  className="vault-onboarding__recent-item"
                  onClick={() => void onSelectRecent(vaultPath)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      void onSelectRecent(vaultPath);
                    }
                  }}
                >
                  <div className="vault-onboarding__recent-main">
                    <IconFolder />
                    <span className="vault-onboarding__recent-path">
                      {vaultPath}
                    </span>
                    {vaultPath === lastVaultPath && (
                      <span className="vault-onboarding__last">
                        Last opened
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="vault-btn vault-btn--ghost vault-btn--icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecent(vaultPath);
                    }}
                    title="Remove from recent list"
                    aria-label={`Remove ${vaultPath} from recent list`}
                  >
                    <IconClose />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <nav className="vault-onboarding__links" aria-label="Help links">
          {WELCOME_LINKS.map(({ command, label }, i) => (
            <Fragment key={command}>
              {i > 0 && <span aria-hidden="true">&middot;</span>}
              <button
                type="button"
                className="vault-onboarding__link"
                onClick={() => HELP_LINK_HANDLERS[command]?.()}
              >
                {label}
              </button>
            </Fragment>
          ))}
        </nav>
      </div>
    </div>
  );
};
