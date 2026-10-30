/**
 * The first-run setup (a lazy chunk): one question per screen, every screen
 * skippable, every answer written to config.toml as it is given. The screens
 * are listed in steps.ts.
 */
import { useEffect, useRef, useState } from "react";

import { isCustomChrome } from "../vault/windowChrome";
import { updatePreferences } from "../vault/preferences";
import { WindowControls } from "../components/WindowControls";

import "../components/home.css";

import { closeSetup } from "./setupStore";
import { SETUP_STEPS } from "./steps";
import { defaultVaultChoice } from "./steps/Vault";

import "./setup.css";

import type { SetupEnv, VaultChoice } from "./types";

export interface SetupWizardProps {
  win: Window;
  hasVault: boolean;
  recentVaults: readonly string[];
  lastVaultPath: string | null;
  onOpenVault: () => void | Promise<void>;
  onCreateVault: () => void | Promise<void>;
  onSelectRecent: (vaultPath: string) => void | Promise<void>;
  refreshAppearance: () => void;
  error?: string | null;
  loading?: boolean;
}

const isButtonLike = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("button, a[href]");

export default function SetupWizard(props: SetupWizardProps) {
  const { win, hasVault, recentVaults, lastVaultPath } = props;
  const [index, setIndex] = useState(0);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [vaultChoice, setVaultChoice] = useState<VaultChoice>(() =>
    defaultVaultChoice({ hasVault, recentVaults, lastVaultPath }),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const step = SETUP_STEPS[index]!;
  const last = index === SETUP_STEPS.length - 1;

  const env: SetupEnv = {
    win,
    hasVault,
    recentVaults,
    lastVaultPath,
    vaultChoice,
    setVaultChoice,
    refreshAppearance: props.refreshAppearance,
    error: props.error,
  };

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    // A new screen starts at the top (a long one was left scrolled by the button below it).
    rootRef.current?.scrollTo?.({ top: 0 });
  }, [index, confirmSkip]);

  const skip = () => {
    updatePreferences({ onboardingCompleted: true }, win);
    closeSetup();
  };

  const finish = async () => {
    updatePreferences({ onboardingCompleted: true }, win);
    closeSetup();
    const c = vaultChoice;
    if (c.kind === "open" || c.kind === "obsidian") {
      await props.onOpenVault();
    } else if (c.kind === "create") {
      await props.onCreateVault();
    } else if (c.kind === "recent") {
      await props.onSelectRecent(c.path);
    }
  };

  const next = () => {
    if (props.loading) {
      return;
    }
    if (last) {
      void finish();
    } else {
      setIndex(index + 1);
    }
  };

  const back = () => {
    if (index > 0) {
      setIndex(index - 1);
    } else {
      setConfirmSkip(true);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }
    // Keys count while focus is in the setup or nowhere (after a click on empty space).
    const t = e.target instanceof Node ? e.target : null;
    if (t && t !== win.document.body && !rootRef.current?.contains(t)) {
      return;
    }
    if (e.key === "Enter" && !isButtonLike(e.target)) {
      e.preventDefault();
      confirmSkip ? skip() : next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      confirmSkip ? setConfirmSkip(false) : back();
    }
  };

  // The latest handler, without re-binding the document listener on every render.
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    win.document.addEventListener("keydown", handler);
    return () => win.document.removeEventListener("keydown", handler);
  }, [win]);

  const Body = step.Component;
  return (
    <div
      className="vault-setup"
      role="dialog"
      aria-modal="true"
      aria-label="Setup"
      data-testid="setup"
      data-step={step.id}
      ref={rootRef}
    >
      <div className="vault-titlebar-drag" data-tauri-drag-region />
      {isCustomChrome(win) && (
        <div className="vault-onboarding__window-controls">
          <WindowControls />
        </div>
      )}
      <div className="vault-setup__card">
        <ol
          className="vault-setup__dots"
          aria-label={`Step ${index + 1} of ${SETUP_STEPS.length}`}
        >
          {SETUP_STEPS.map((s, i) => (
            <li
              key={s.id}
              data-state={i === index ? "now" : i < index ? "done" : "todo"}
            />
          ))}
        </ol>
        <div className="vault-setup__page" key={step.id}>
          {step.hero && (
            <>
              <div className="vault-onboarding__logo" aria-hidden="true" />
              <p className="vault-setup__brand" aria-label="Vaultdraw">
                vault
                <span className="vault-onboarding__title-accent">draw</span>
              </p>
            </>
          )}
          <h1 className="vault-setup__title" tabIndex={-1} ref={headingRef}>
            {confirmSkip ? "Skip the setup?" : step.title(env)}
          </h1>
          {confirmSkip ? (
            <p className="vault-setup__sub">
              Everything stays as it is now. Run setup again from the command
              palette any time.
            </p>
          ) : (
            step.subtitle && (
              <p className="vault-setup__sub">{step.subtitle(env)}</p>
            )
          )}
          {!confirmSkip && (
            <div className="vault-setup__body">
              <Body env={env} />
            </div>
          )}
        </div>
        <div className="vault-setup__foot">
          {confirmSkip ? (
            <>
              <button
                type="button"
                className="vault-setup__ghost"
                onClick={() => setConfirmSkip(false)}
              >
                <kbd className="vault-kbd">Esc</kbd> Keep going
              </button>
              <button
                type="button"
                className="vault-setup__primary"
                onClick={skip}
              >
                Skip setup
              </button>
            </>
          ) : (
            <>
              <span className="vault-setup__foot-left">
                {index > 0 && (
                  <button
                    type="button"
                    className="vault-setup__ghost"
                    onClick={back}
                  >
                    <kbd className="vault-kbd">Esc</kbd> Back
                  </button>
                )}
                {!last && (
                  <button
                    type="button"
                    className="vault-setup__ghost"
                    onClick={skip}
                  >
                    Skip setup
                  </button>
                )}
              </span>
              <button
                type="button"
                className="vault-setup__primary"
                onClick={next}
                disabled={props.loading}
              >
                {step.nextLabel?.(env) ?? "Next"}
                <kbd className="vault-kbd">Enter</kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
