import { useEffect } from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { SETUP_COMMAND_IDS } from "../commands/setupCommands";

import { requestSetup } from "./setupStore";

/** Binds "Run setup again". */
export function useSetupCommand(): void {
  useEffect(
    () => registerCommandHandlers({ [SETUP_COMMAND_IDS.run]: requestSetup }),
    [],
  );
}
