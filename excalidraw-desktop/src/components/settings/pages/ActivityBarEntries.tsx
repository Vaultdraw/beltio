/**
 * Settings > Interface: show/hide and reorder the activity bar's entries.
 * Order and hidden set are two config keys saved together in one scope.
 */
// Registers the built-in entries.
import "../../../activityBar/entries";
import { useActivityEntries } from "../../../activityBar/activityBarRegistry";
import {
  moveActivityEntry,
  resolveActivityLayout,
  setActivityEntryHidden,
} from "../../../activityBar/layout";
import { useSettings } from "../SettingsContext";

import { Switch } from "./controls";
import { ScopedRow } from "./scopedRow";
import "./activityBarEntries.css";

export const ActivityBarEntriesSetting = () => {
  const entries = useActivityEntries();
  const { scope, scopedValue, setScopedValue } = useSettings();
  const order = scopedValue("activityBarOrder");
  const hidden = scopedValue("activityBarHidden");
  const rows = resolveActivityLayout(entries, order, hidden);
  const customised = order.length > 0 || hidden.length > 0;

  const setOrder = (next: string[]) => {
    setScopedValue("activityBarOrder", next);
    // Both keys move together, so a vault override always holds the pair.
    setScopedValue("activityBarHidden", [...hidden]);
  };
  const setHidden = (id: string, hide: boolean) => {
    setScopedValue(
      "activityBarHidden",
      setActivityEntryHidden(entries, hidden, id, hide),
    );
    setScopedValue("activityBarOrder", [...order]);
  };
  const reset = () => {
    setScopedValue("activityBarOrder", []);
    setScopedValue("activityBarHidden", []);
  };

  return (
    <ScopedRow
      id="activity-bar-entries"
      field="activityBarOrder"
      alsoReset={["activityBarHidden"]}
      layout="stacked"
    >
      {() => (
        <div className="vault-abe">
          <ul className="vault-abe__list" aria-label="Activity bar entries">
            {rows.map(({ entry, hidden: isHidden }, i) => {
              const Icon = entry.icon;
              const sameGroup = (j: number) =>
                rows[j]?.entry.group === entry.group;
              const canUp = rows.slice(0, i).some((_, j) => sameGroup(j));
              const canDown = rows
                .slice(i + 1)
                .some((_, j) => sameGroup(i + 1 + j));
              return (
                <li
                  key={entry.id}
                  className="vault-abe__row"
                  data-entry={entry.id}
                  data-hidden={isHidden || undefined}
                >
                  <Icon aria-hidden="true" focusable="false" />
                  <span className="vault-abe__name">{entry.label}</span>
                  <button
                    type="button"
                    className="vault-btn vault-btn--ghost vault-btn--sm"
                    aria-label={`Move ${entry.label} up`}
                    disabled={!canUp}
                    onClick={() =>
                      setOrder(moveActivityEntry(entries, order, entry.id, -1))
                    }
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="vault-btn vault-btn--ghost vault-btn--sm"
                    aria-label={`Move ${entry.label} down`}
                    disabled={!canDown}
                    onClick={() =>
                      setOrder(moveActivityEntry(entries, order, entry.id, 1))
                    }
                  >
                    Down
                  </button>
                  <Switch
                    checked={!isHidden}
                    label={`Show ${entry.label}`}
                    onChange={(show) => setHidden(entry.id, !show)}
                  />
                </li>
              );
            })}
          </ul>
          {customised && scope === "global" && (
            <button
              type="button"
              className="vault-btn vault-btn--ghost vault-btn--sm"
              onClick={reset}
            >
              Reset order and visibility
            </button>
          )}
        </div>
      )}
    </ScopedRow>
  );
};
