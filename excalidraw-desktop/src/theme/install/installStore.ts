/**
 * Tiny eager store that opens the install dialog (the dialog itself is a lazy
 * chunk). Commands, Settings and the "no longer built in" notice all open it
 * from here, so none of them import the dialog.
 */

export type InstallDialogRequest =
  | {
      mode: "install";
      /** Pre-filled address or `owner/repo`. */
      input?: string;
      /** A theme name to pick once a repo is listed. */
      pick?: string;
    }
  | { mode: "update" | "uninstall" };

type Listener = () => void;

let request: InstallDialogRequest | null = null;
const listeners = new Set<Listener>();

const set = (next: InstallDialogRequest | null) => {
  request = next;
  listeners.forEach((l) => l());
};

export const openInstallDialog = (
  next: InstallDialogRequest = { mode: "install" },
) => set(next);
export const closeInstallDialog = () => set(null);
export const getInstallDialogRequest = () => request;
export const subscribeInstallDialog = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
