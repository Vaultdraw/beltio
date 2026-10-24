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
      message="This deletes overrides.toml, the file Settings saves your changes to. Values go back to config.toml, or to the defaults. config.toml is not touched."
      confirmLabel="Reset changes"
      isDanger
      onConfirm={() => void confirmResetOverrides()}
      onCancel={cancelResetRequest}
    />
  );
};
