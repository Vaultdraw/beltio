import { useSyncExternalStore } from "react";

import {
  EXTENSION_FIELDS,
  type ExtensionId,
} from "../../extensionSwitches/registry";
import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../vault/preferences";
import { SwitchRow } from "../controls";

import type { StepProps } from "../types";

/** The optional extras offered at setup, in order. Each is a Settings → Extensions switch. */
export const SETUP_EXTRAS: readonly {
  id: ExtensionId;
  label: string;
  hint: string;
}[] = [
  {
    id: "notes",
    label: "Markdown notes",
    hint: "Open and edit .md files next to your drawings.",
  },
  { id: "formula", label: "Formulas", hint: "Typeset maths on the canvas." },
  {
    id: "mermaid",
    label: "Mermaid diagrams",
    hint: "Turn Mermaid text into shapes.",
  },
  {
    id: "pdf-import",
    label: "PDF import",
    hint: "Bring PDF pages in as pictures.",
  },
  {
    id: "graph",
    label: "Graph view",
    hint: "See how your drawings link together.",
  },
  {
    id: "history",
    label: "History panel",
    hint: "Browse and restore earlier versions.",
  },
];

export const Extras = ({ env }: StepProps) => {
  const { win } = env;
  const prefs = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win),
    () => getPreferences(win),
  );
  return (
    <>
      {SETUP_EXTRAS.map((e) => (
        <SwitchRow
          key={e.id}
          id={`setup-ext-${e.id}`}
          label={e.label}
          hint={e.hint}
          checked={prefs[EXTENSION_FIELDS[e.id]]}
          onChange={(on) =>
            updatePreferences({ [EXTENSION_FIELDS[e.id]]: on }, win)
          }
        />
      ))}
      <p className="vault-setup__note" data-testid="setup-ai-note">
        AI assistant: off. It sends nothing until you turn it on in Settings,
        where its privacy note is shown first.
      </p>
    </>
  );
};
