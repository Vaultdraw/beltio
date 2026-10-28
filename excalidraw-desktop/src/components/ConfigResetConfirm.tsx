import { useSyncExternalStore } from "react";

import {
  cancelResetRequest,
  confirmResetOverrides,
  getResetRequest,
  subscribeResetRequest,
} from "../commands/configCommands";

import { ConfirmModal } from "./ConfirmModal";

/** Confirmation for `config.resetOverrides` and Settings → General → Reset. */
export const ConfigResetConfirm = () => {
  const open = useSyncExternalStore(subscribeResetRequest, getResetRequest);
  if (!open) {
    return null;
  }
  return (
    <ConfirmModal
      title="Reset Settings changes"
      message="This forgets everything you changed in Settings. Values go back to your config file, or to the defaults. Your config file is not touched."
      confirmLabel="Reset changes"
      isDanger
      onConfirm={() => void confirmResetOverrides()}
      onCancel={cancelResetRequest}
    />
  );
};
