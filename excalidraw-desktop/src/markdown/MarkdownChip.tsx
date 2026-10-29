/** The "Markdown" chip in the editor footer: shows the drawing's mode and toggles it. */
import { useCommandShortcut } from "../commands/useCommandShortcut";

import { MARKDOWN_TOGGLE_COMMAND } from "./useMarkdownMode";

import "./markdownChip.css";

export function MarkdownChip({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const keys = useCommandShortcut(MARKDOWN_TOGGLE_COMMAND);
  const state = on ? "on" : "off";
  return (
    <button
      type="button"
      className="vault-markdown-chip"
      data-testid="markdown-chip"
      aria-pressed={on}
      disabled={disabled}
      title={`Markdown mode is ${state}: # and a space make a heading${
        keys ? ` (${keys})` : ""
      }`}
      onClick={onToggle}
    >
      Markdown
    </button>
  );
}
