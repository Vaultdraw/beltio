import { lazy, Suspense, useSyncExternalStore } from "react";

import {
  closeProfileDialog,
  getProfileDialog,
  subscribeProfileDialog,
} from "../commands/profileCommands";

// The dialog code loads on first use: nothing at startup.
const ProfileDialog = lazy(() =>
  import("./ProfileDialog").then((m) => ({ default: m.ProfileDialog })),
);

/** Renders the profile dialog (switch, new, duplicate, delete) when one is open. */
export const ProfileDialogHost = () => {
  const request = useSyncExternalStore(
    subscribeProfileDialog,
    getProfileDialog,
  );
  if (!request) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <ProfileDialog
        key={request.id}
        mode={request.mode}
        onClose={closeProfileDialog}
      />
    </Suspense>
  );
};
