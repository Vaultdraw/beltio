/** Obsidian-style graph settings: colour groups, display and forces sliders. */
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings } from "./settings";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="vd-graph__row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

const NEW_GROUP_COLOURS = [
  "#e8590c",
  "#2f9e44",
  "#1c7ed6",
  "#ae3ec9",
  "#f08c00",
];

/** Display and forces back to their defaults (the panel's reset button and the `graph.resetDisplay` command). */
export const resetDisplayAndForces = (s: GraphSettings): GraphSettings => ({
  ...s,
  textFade: DEFAULT_GRAPH_SETTINGS.textFade,
  nodeSize: DEFAULT_GRAPH_SETTINGS.nodeSize,
  linkThickness: DEFAULT_GRAPH_SETTINGS.linkThickness,
  forces: { ...DEFAULT_GRAPH_SETTINGS.forces },
});

export interface SettingsPanelProps {
  settings: GraphSettings;
  onChange: (next: GraphSettings) => void;
}

export function SettingsPanel({ settings: s, onChange }: SettingsPanelProps) {
  const set = (patch: Partial<GraphSettings>) => onChange({ ...s, ...patch });
  const force = (patch: Partial<GraphSettings["forces"]>) =>
    set({ forces: { ...s.forces, ...patch } });
  const setGroup = (i: number, patch: Partial<GraphSettings["groups"][0]>) =>
    set({ groups: s.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <aside className="vd-graph__panel" aria-label="Graph settings">
      <h3>Groups</h3>
      {s.groups.map((g, i) => (
        <div className="vd-graph__group" key={i}>
          <input
            type="text"
            value={g.query}
            placeholder="path:Folder  tag:#x  name"
            aria-label="Group query"
            onChange={(e) => setGroup(i, { query: e.target.value })}
          />
          <input
            type="color"
            value={g.colour}
            aria-label="Group colour"
            onChange={(e) => setGroup(i, { colour: e.target.value })}
          />
          <button
            type="button"
            aria-label="Remove group"
            onClick={() => set({ groups: s.groups.filter((_, k) => k !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="vd-graph__btn"
        onClick={() =>
          set({
            groups: [
              ...s.groups,
              {
                query: "",
                colour:
                  NEW_GROUP_COLOURS[s.groups.length % NEW_GROUP_COLOURS.length],
              },
            ],
          })
        }
      >
        New group
      </button>
      <h3>Display</h3>
      <Slider
        label="Text fade threshold"
        value={s.textFade}
        min={0.05}
        max={2}
        step={0.05}
        onChange={(textFade) => set({ textFade })}
      />
      <Slider
        label="Node size"
        value={s.nodeSize}
        min={0.4}
        max={3}
        step={0.1}
        onChange={(nodeSize) => set({ nodeSize })}
      />
      <Slider
        label="Link thickness"
        value={s.linkThickness}
        min={0.2}
        max={3}
        step={0.1}
        onChange={(linkThickness) => set({ linkThickness })}
      />
      <h3>Forces</h3>
      <Slider
        label="Centre force"
        value={s.forces.centre}
        min={0}
        max={1}
        step={0.01}
        onChange={(centre) => force({ centre })}
      />
      <Slider
        label="Repel force"
        value={s.forces.repel}
        min={0}
        max={20}
        step={0.5}
        onChange={(repel) => force({ repel })}
      />
      <Slider
        label="Link force"
        value={s.forces.linkForce}
        min={0}
        max={2}
        step={0.05}
        onChange={(linkForce) => force({ linkForce })}
      />
      <Slider
        label="Link distance"
        value={s.forces.linkDistance}
        min={5}
        max={200}
        step={1}
        onChange={(linkDistance) => force({ linkDistance })}
      />
      <button
        type="button"
        className="vd-graph__btn"
        onClick={() => onChange(resetDisplayAndForces(s))}
      >
        Reset display and forces
      </button>
    </aside>
  );
}
