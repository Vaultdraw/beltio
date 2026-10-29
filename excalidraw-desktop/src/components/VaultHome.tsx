/**
 * Vault home: the empty state while no drawing is open. Four primary actions
 * (each runs a registry command and shows its live shortcut) and the recent
 * drawings. Plain buttons, so Tab / Enter reach everything.
 */
import { useSyncExternalStore } from "react";

import { PALETTE_COMMANDS_ID, PALETTE_FILES_ID } from "../commands/commands";
import { formatChord } from "../commands/keys";
import { getRegisteredCommand, subscribeCommands } from "../commands/registry";
import { useCommandShortcutLookup } from "../commands/useCommandShortcut";
import { OBSIDIAN_IMPORT_COMMAND_ID } from "../plugins/officialPlugins";
import { RecentDrawings } from "../thumbnails/surfaces/RecentDrawings";

import {
  IconCommand,
  IconDrawing,
  IconFolderOpen,
  IconPlus,
  IconSearch,
  IconTemplate,
} from "./Icons";

import "./home.css";

export interface HomeAction {
  /** Command registry id: the shortcut shown is this command's live binding. */
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Needs a writable vault. */
  writes: boolean;
  primary?: boolean;
}

export const HOME_ACTIONS: readonly HomeAction[] = [
  {
    id: "vault.newDrawing",
    label: "New drawing",
    icon: <IconPlus />,
    writes: true,
    primary: true,
  },
  {
    id: "vault.newFromTemplate",
    label: "New from template…",
    icon: <IconTemplate />,
    writes: true,
  },
  {
    id: PALETTE_FILES_ID,
    label: "Go to drawing",
    icon: <IconSearch />,
    writes: false,
  },
  {
    id: PALETTE_COMMANDS_ID,
    label: "Show all commands",
    icon: <IconCommand />,
    writes: false,
  },
];

/**
 * Shown while the Markdown import is on: someone coming from Obsidian finds the import on the
 * first screen, not only in the drawing's main menu or the palette (test-net TN-3).
 */
const OBSIDIAN_IMPORT: HomeAction = {
  id: OBSIDIAN_IMPORT_COMMAND_ID,
  label: "Import Obsidian vault…",
  icon: <IconFolderOpen />,
  writes: true,
};

export interface HomeRecent {
  path: string;
  name: string;
  folder: string;
}

interface VaultHomeProps {
  readOnly: boolean;
  recent: readonly HomeRecent[];
  onRun(id: string): void;
  onOpenDrawing(path: string): void;
  ownerWindow?: Window | null;
  /** True while a full-pane view (the graph) covers the home. */
  inert?: boolean;
}

export const VaultHome = ({
  readOnly,
  recent,
  onRun,
  onOpenDrawing,
  ownerWindow,
  inert,
}: VaultHomeProps) => {
  const shortcut = useCommandShortcutLookup(ownerWindow ?? null, formatChord);
  // The plugin's stub registers the command at boot, so this loads no plugin code.
  const hasObsidianImport = useSyncExternalStore(
    subscribeCommands,
    () => !!getRegisteredCommand(OBSIDIAN_IMPORT_COMMAND_ID),
    () => false,
  );
  return (
    <div className="vault-empty-state vault-home" inert={inert}>
      <div className="vault-empty-state__icon">
        <IconDrawing width="40" height="40" />
      </div>
      <h2 className="vault-empty-state__title">No drawing open</h2>
      <p className="vault-empty-state__desc">
        Pick a drawing from the navigator or start something new.
      </p>
      <div className="vault-home__actions">
        {[...HOME_ACTIONS, ...(hasObsidianImport ? [OBSIDIAN_IMPORT] : [])]
          .filter((a) => !(a.writes && readOnly))
          .map((action) => {
            const keys = shortcut(action.id);
            return (
              <button
                key={action.id}
                type="button"
                className={`vault-home__action${
                  action.primary ? " vault-home__action--primary" : ""
                }`}
                onClick={() => onRun(action.id)}
              >
                {action.icon}
                <span className="vault-home__label">{action.label}</span>
                {keys && <kbd className="vault-kbd">{keys}</kbd>}
              </button>
            );
          })}
      </div>
      <RecentDrawings entries={recent} onOpen={onOpenDrawing} />
    </div>
  );
};
