/**
 * App-level AI switch wiring for VaultApp: registers the three palette commands
 * and shows the privacy warning while one is pending. Nothing runs at startup
 * or idle beyond two handler registrations.
 */
import { useEffect, useSyncExternalStore } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";

import { AI_COMMAND_IDS } from "./aiCommands";
import {
  cancelAiOn,
  isAiWarningPending,
  subscribeAiWarning,
  toggleAi,
  toggleMcp,
  copyMcpSetup,
} from "./aiSwitch";
import { AiWarningDialog } from "./AiWarningDialog";

export const AiHost = ({ win }: { win: Window | null }) => {
  useEffect(() => {
    const stop = registerCommandHandlers({
      [AI_COMMAND_IDS.toggle]: () => toggleAi(win),
      [AI_COMMAND_IDS.toggleMcp]: () => toggleMcp(win),
      [AI_COMMAND_IDS.copyMcpSetup]: () => copyMcpSetup(win),
    });
    return () => {
      stop();
      // An unanswered warning never comes back later out of context.
      cancelAiOn();
    };
  }, [win]);
  const pending = useSyncExternalStore(subscribeAiWarning, isAiWarningPending);
  return pending ? <AiWarningDialog win={win} /> : null;
};
