import { useEffect, useRef, useState, type RefObject } from "react";

import type { GraphMode, GraphSettings } from "./settings";

export const SEARCH_DEBOUNCE_MS = 120;

export interface GraphToolbarProps {
  settings: GraphSettings;
  onSettingsChange: (next: GraphSettings) => void;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  onFit: () => void;
  onClose: () => void;
  panelOpen: boolean;
  onPanelToggle: () => void;
  filterRef: RefObject<HTMLInputElement | null>;
  /** Called when the filter box should hand focus back to the stage (Esc / Enter). */
  onFilterDone: () => void;
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="vd-graph__toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function GraphToolbar(p: GraphToolbarProps) {
  const s = p.settings;
  const set = (patch: Partial<GraphSettings>) =>
    p.onSettingsChange({ ...s, ...patch });
  // The box is typed into freely; the (O(n)) match runs once typing pauses.
  const [text, setText] = useState(s.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ s, onChange: p.onSettingsChange });
  latest.current = { s, onChange: p.onSettingsChange };
  useEffect(() => {
    setText(s.search);
  }, [s.search]);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  const onText = (value: string) => {
    setText(value);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current.onChange({ ...latest.current.s, search: value });
    }, SEARCH_DEBOUNCE_MS);
  };
  return (
    <div className="vd-graph__toolbar" role="toolbar" aria-label="Graph">
      <div className="vd-graph__seg" role="group" aria-label="Scope">
        <button
          type="button"
          aria-pressed={p.mode === "global"}
          onClick={() => p.onModeChange("global")}
        >
          Global
        </button>
        <button
          type="button"
          aria-pressed={p.mode === "local"}
          title="Local graph (L)"
          onClick={() => p.onModeChange("local")}
        >
          Local
        </button>
      </div>
      {p.mode === "local" && (
        <div className="vd-graph__seg" role="group" aria-label="Depth">
          {([1, 2, 3] as const).map((d) => (
            <button
              type="button"
              key={d}
              aria-pressed={s.localDepth === d}
              title={`Depth ${d} (${d})`}
              onClick={() => set({ localDepth: d })}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <input
        ref={p.filterRef}
        className="vd-graph__filter"
        type="search"
        placeholder="Filter  (/)  path:  tag:#"
        aria-label="Filter graph"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            p.onFilterDone();
          }
        }}
      />
      <Toggle
        label="Tags"
        checked={s.showTags}
        onChange={(showTags) => set({ showTags })}
      />
      <Toggle
        label="Unresolved"
        checked={s.showUnresolved}
        onChange={(showUnresolved) => set({ showUnresolved })}
      />
      <Toggle
        label="Orphans"
        checked={s.showOrphans}
        onChange={(showOrphans) => set({ showOrphans })}
      />
      <Toggle
        label="Arrows"
        checked={s.arrows}
        onChange={(arrows) => set({ arrows })}
      />
      <div className="vd-graph__seg" role="group" aria-label="Colour">
        <button
          type="button"
          aria-pressed={s.colourBy === "folder"}
          onClick={() => set({ colourBy: "folder" })}
        >
          Folder
        </button>
        <button
          type="button"
          aria-pressed={s.colourBy === "mono"}
          onClick={() => set({ colourBy: "mono" })}
        >
          Mono
        </button>
      </div>
      <span className="vd-graph__spacer" />
      <button
        type="button"
        className="vd-graph__btn"
        title="Fit (0)"
        onClick={p.onFit}
      >
        Fit
      </button>
      <button
        type="button"
        className="vd-graph__btn"
        aria-expanded={p.panelOpen}
        onClick={p.onPanelToggle}
      >
        Settings
      </button>
      <button
        type="button"
        className="vd-graph__btn"
        title="Close (Esc)"
        onClick={p.onClose}
      >
        Close
      </button>
    </div>
  );
}
