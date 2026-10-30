import { Dialog } from "../components/Dialog";

import { cancelAiOn, confirmAiOn } from "./aiSwitch";

export const AI_WARNING_TEXT =
  'While AI is on, an AI app you connect to Vaultdraw (a desktop assistant or a coding agent) can read and edit your drawings. What it reads, it sends to the AI provider that app uses, under that app\'s terms. Vaultdraw itself sends your drawings nowhere. Turn AI off at any time in Settings, Control, or with the command "AI: Toggle AI".';

/** The privacy warning shown before AI is turned on. Escape and Cancel keep it off. */
export const AiWarningDialog = ({ win }: { win: Window | null }) => {
  return (
    <Dialog
      title="Turn on AI?"
      titleId="ai-warning-title"
      testId="ai-warning"
      onClose={cancelAiOn}
      footer={
        <>
          <button
            type="button"
            className="vault-btn"
            autoFocus
            onClick={cancelAiOn}
          >
            Cancel
          </button>
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            data-testid="ai-warning-confirm"
            onClick={() => confirmAiOn(win)}
          >
            Turn on
          </button>
        </>
      }
    >
      <p>{AI_WARNING_TEXT}</p>
    </Dialog>
  );
};
