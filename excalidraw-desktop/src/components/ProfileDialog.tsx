import { useState } from "react";

import {
  createProfile,
  DEFAULT_PROFILE,
  deleteProfile,
  getProfiles,
  profileNameError,
  switchProfile,
} from "../vault/profiles";

import { ConfirmModal } from "./ConfirmModal";
import { Dialog } from "./Dialog";

import type { ProfileDialogMode } from "../commands/profileCommands";

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

interface Props {
  mode: ProfileDialogMode;
  onClose: () => void;
}

/** One dialog for the four profile commands. */
export const ProfileDialog = ({ mode, onClose }: Props) => {
  const { active, profiles } = getProfiles();
  const current = active ?? DEFAULT_PROFILE;
  const [name, setName] = useState("");
  const [from, setFrom] = useState(mode === "duplicate" ? current : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (toDelete) {
    return (
      <ConfirmModal
        title="Delete profile"
        message={`Delete the profile "${toDelete}" and its files (profiles/${toDelete}/)? Your config file is not touched.${
          toDelete === active ? " The default profile applies afterwards." : ""
        }`}
        confirmLabel="Delete profile"
        isDanger
        onConfirm={() => void run(() => deleteProfile(toDelete))}
        onCancel={onClose}
      />
    );
  }

  if (mode === "switch" || mode === "delete") {
    const names =
      mode === "switch" ? [DEFAULT_PROFILE, ...profiles] : [...profiles];
    return (
      <Dialog
        title={mode === "switch" ? "Switch profile" : "Delete a profile"}
        titleId="profile-dialog-title"
        onClose={onClose}
        busy={busy}
        footer={
          <button type="button" className="vault-btn" onClick={onClose}>
            Cancel
          </button>
        }
      >
        {names.length === 0 ? (
          <p>
            There are no profiles yet. Use Profile: New profile to make one.
          </p>
        ) : (
          <ul className="vault-profile-list" aria-label="Profiles">
            {names.map((n) => (
              <li key={n}>
                <button
                  type="button"
                  className="vault-btn vault-btn--sm"
                  autoFocus={n === current}
                  disabled={busy}
                  aria-current={mode === "switch" && n === current}
                  onClick={() =>
                    mode === "switch"
                      ? void run(() => switchProfile(n))
                      : setToDelete(n)
                  }
                >
                  {n}
                  {mode === "switch" && n === current ? " (active)" : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <div role="alert">{error}</div>}
      </Dialog>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const problem = profileNameError(trimmed, profiles);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      await createProfile(trimmed, from || null);
      await switchProfile(trimmed);
    });
  };

  return (
    <Dialog
      title={mode === "new" ? "New profile" : "Duplicate profile"}
      titleId="profile-dialog-title"
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="vault-btn vault-btn--primary"
            disabled={busy || !name.trim()}
          >
            {mode === "new" ? "Create" : "Duplicate"}
          </button>
        </>
      }
    >
      <div className="vault-field">
        <label htmlFor="profile-name">Profile name</label>
        <input
          id="profile-name"
          type="text"
          className="vault-input"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="vault-field">
        <label htmlFor="profile-from">
          {mode === "new" ? "Start from" : "Copy of"}
        </label>
        <select
          id="profile-from"
          className="vault-input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          {mode === "new" && <option value="">Nothing (empty)</option>}
          <option value={DEFAULT_PROFILE}>
            {DEFAULT_PROFILE} (your Settings changes)
          </option>
          {profiles.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p>
        The new profile becomes the active one. Switch back any time with
        Profile: Switch profile.
      </p>
      {error && <div role="alert">{error}</div>}
    </Dialog>
  );
};
