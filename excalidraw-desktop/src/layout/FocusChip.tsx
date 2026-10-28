/** The small "Focus" chip shown while focus mode is on and `[focus] hint = true`. */
import { useCommandShortcut } from "../commands/useCommandShortcut";

import { LAYOUT_COMMAND_IDS } from "./layoutCommands";

export function FocusChip({
  win,
  onExit,
}: {
  win: Window | null;
  onExit: () => void;
}) {
  const key = useCommandShortcut(LAYOUT_COMMAND_IDS.exitFocus, win);
  return (
    <button
      type="button"
      className="vault-focus-chip"
      title="Exit focus mode"
      onClick={onExit}
    >
      Focus{key ? ` · ${key}` : ""}
    </button>
  );
}
