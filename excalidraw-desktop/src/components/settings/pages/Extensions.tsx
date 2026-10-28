/**
 * Settings → Extensions: one switch per built-in extension (`[extensions]`),
 * plus the two features that already have their own key (history,
 * thumbnails). Off means not created: the feature loads nothing and runs
 * nothing. Loaded only when the page is shown (extensionsEntry.tsx).
 */
import { useSyncExternalStore } from "react";

import { beginBisect } from "../../../extensionSwitches/bisectCommands";
import {
  getBisect,
  subscribeBisect,
} from "../../../extensionSwitches/bisectState";
import { restoreExtensionDefaults } from "../../../extensionSwitches/extensionCommands";
import { EXTENSION_TEXT } from "../../../extensionSwitches/extensionsText";
import {
  BUILTIN_EXTENSIONS,
  EXTENSION_FIELDS,
  type BuiltinExtension,
} from "../../../extensionSwitches/registry";
import {
  getSafeStart,
  safeStartReasonText,
  subscribeSafeStart,
} from "../../../safeStart/state";
import { subscribePreferences } from "../../../vault/preferences";
import { cachedPreferences, useGlobalPref } from "../../../vault/useGlobalPref";
import { SettingRow } from "../SettingRow";
import { useSettings } from "../SettingsContext";

import { Switch } from "./controls";

import "./extensions.css";

import type { ReactNode } from "react";

const useGlobalPrefs = (win: Window | null | undefined) =>
  useSyncExternalStore(subscribePreferences, () => cachedPreferences(win));

const Row = ({
  id,
  title,
  description,
  note,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  note?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
}) => (
  <li className="vault-extensions__item" data-testid={`extension-row-${id}`}>
    <div className="vault-extensions__text">
      <span className="vault-extensions__title">{title}</span>
      <span className="vault-extensions__desc">{description}</span>
      {note && <span className="vault-extensions__note">{note}</span>}
    </div>
    <Switch checked={checked} label={title} onChange={onChange} />
  </li>
);

const ExtensionRow = ({ ext }: { ext: BuiltinExtension }) => {
  const { win } = useSettings();
  const [on, setOn] = useGlobalPref(win, EXTENSION_FIELDS[ext.id]);
  const text = EXTENSION_TEXT[ext.id];
  return (
    <Row
      id={ext.id}
      title={ext.title}
      description={text.description}
      note={!on ? text.offNote : undefined}
      checked={on}
      onChange={setOn}
    />
  );
};

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className="vault-extensions__group" aria-label={label}>
    <h3 className="vault-extensions__heading">{label}</h3>
    <ul className="vault-extensions">{children}</ul>
  </section>
);

export const ExtensionsPage = () => {
  const { win } = useSettings();
  // The switches as saved (not the effective set, which is all off in safe start).
  const ext = useGlobalPrefs(win);
  const safe = useSyncExternalStore(subscribeSafeStart, getSafeStart);
  const bisect = useSyncExternalStore(subscribeBisect, getBisect);
  const [history, setHistory] = useGlobalPref(win, "historyEnabled");
  const [thumbnails, setThumbnails] = useGlobalPref(win, "thumbnails");
  // Official plugins are switched through the plugin list (`plugins.enabled`).
  const [enabledPlugins, setEnabledPlugins] = useGlobalPref(
    win,
    "pluginsEnabled",
  );
  const galleryOn = enabledPlugins.includes("gallery");
  const indexNeededBy = BUILTIN_EXTENSIONS.filter(
    (e) =>
      ["search", "tags", "links", "graph"].includes(e.id) &&
      ext[EXTENSION_FIELDS[e.id]],
  ).map((e) => e.title);

  return (
    <SettingRow
      id="extensions-list"
      layout="stacked"
      testId="settings-extensions"
      aside={
        <>
          {!bisect && !safe && (
            <button
              type="button"
              className="vault-btn vault-btn--sm"
              title="Turns half of the extensions off and restarts, again and again, until the one causing a problem is found"
              onClick={() => void beginBisect(win)}
            >
              Find a problem extension
            </button>
          )}
          <button
            type="button"
            className="vault-btn vault-btn--sm"
            onClick={() => restoreExtensionDefaults(win)}
          >
            Restore defaults
          </button>
        </>
      }
    >
      {safe?.scope === "core" && (
        <p className="vault-extensions__safe" role="status">
          Safe start ({safeStartReasonText(safe)}): none of these run now.
          Changes apply after Restart normally.
        </p>
      )}
      <Group label="Built-in">
        {BUILTIN_EXTENSIONS.filter((e) => e.kind === "builtin").map((e) => (
          <ExtensionRow key={e.id} ext={e} />
        ))}
        <Row
          id="history-record"
          title="File history"
          description="Save versions of each drawing in the vault. Independent of the History panel switch."
          note="A vault can override this on the History page."
          checked={history}
          onChange={setHistory}
        />
        <Row
          id="thumbnails"
          title="Thumbnails"
          description="Drawing previews on the home screen, in search, the palette and the gallery."
          checked={thumbnails}
          onChange={setThumbnails}
        />
      </Group>
      <Group label="Optional">
        <Row
          id="gallery"
          title="Gallery"
          description="A grid of drawing thumbnails for a folder (Mod+Alt+E). Loads only when opened."
          note={
            !galleryOn ? "Off: no Gallery button, commands or code." : undefined
          }
          checked={galleryOn}
          onChange={(on) =>
            setEnabledPlugins(
              on
                ? [...enabledPlugins.filter((x) => x !== "gallery"), "gallery"]
                : enabledPlugins.filter((x) => x !== "gallery"),
            )
          }
        />
        {BUILTIN_EXTENSIONS.filter((e) => e.kind === "official").map((e) => (
          <ExtensionRow key={e.id} ext={e} />
        ))}
      </Group>
      <Group label="Core services">
        <li
          className="vault-extensions__item"
          data-testid="extension-row-index"
        >
          <div className="vault-extensions__text">
            <span className="vault-extensions__title">Vault index</span>
            <span className="vault-extensions__desc">
              {indexNeededBy.length > 0
                ? `Needed by ${indexNeededBy.join(
                    ", ",
                  )}. Starts when idle or on first use.`
                : "Not needed: it does not start. Renaming may still read it once to update links."}
            </span>
          </div>
        </li>
      </Group>
    </SettingRow>
  );
};
