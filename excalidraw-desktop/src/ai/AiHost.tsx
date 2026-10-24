/**
 * App-level AI switch wiring for VaultApp: registers the two palette commands
 * and shows the privacy warning while one is pending. Nothing runs at startup
 * or idle beyond two handler registrations.
 */
import { useEffect, useSyncExternalStore } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { AI_COMMAND_IDS } from "./aiCommands";
import {
  isAiWarningPending,
  subscribeAiWarning,
  toggleAi,
  toggleMcp,
} from "./aiSwitch";
import { AiWarningDialog } from "./AiWarningDialog";

export const AiHost = ({ win }: { win: Window | null }) => {
  useEffect(
    () =>
      registerCommandHandlers({
        [AI_COMMAND_IDS.toggle]: () => toggleAi(win),
        [AI_COMMAND_IDS.toggleMcp]: () => toggleMcp(win),
      }),
    [win],
  );
  const pending = useSyncExternalStore(subscribeAiWarning, isAiWarningPending);
  return pending ? <AiWarningDialog win={win} /> : null;
};
