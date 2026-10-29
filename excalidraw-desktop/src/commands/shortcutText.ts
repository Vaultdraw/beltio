/**
 * Descriptions that name a key write `({{key:command.id}})`; the words show the
 * user's real binding (rebinds included), or nothing (in parentheses) or "its key" when the command has none.
 */
const TOKEN = /(\s?)(\()?\{\{key:([\w.:-]+)\}\}(\))?/g;

export function withShortcuts(
  text: string,
  lookup: (id: string) => string,
): string {
  return text.replace(
    TOKEN,
    (_all, space: string, open: string | undefined, id: string) => {
      const label = lookup(id);
      if (open) {
        return label ? `${space}(${label})` : "";
      }
      return `${space}${label || "its key"}`;
    },
  );
}

/** The text without the key tokens: what Settings search matches. */
export const withoutShortcuts = (text: string): string =>
  withShortcuts(text, () => "");
