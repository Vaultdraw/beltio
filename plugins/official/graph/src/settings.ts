/**
 * Graph view settings (frozen P3 contract). Per vault, like Obsidian's
 * graph.json: stored in `<vault>/.excalidraw-vault/settings.toml` [graph]
 * (DECISIONS.md D15/D17). Defaults follow Obsidian's graph defaults.
 */
import { DEFAULT_FORCE_SETTINGS, type ForceSettings } from "./barnesHut";

/** Where a drawing opens: the current tab or a new one. */
export type OpenTarget = "current" | "new";

/** A colour group: nodes matching `query` (`path:`, `tag:#x`, or a name) get `colour`. */
export type GraphColourGroup = { query: string; colour: string };

export type GraphSettings = {
  // Filters
  /** Filter box text (same grammar as groups); non-matching nodes are dimmed. */
  search: string;
  /** Tag nodes and doc->tag edges (Obsidian: off; on here, graph-feel D-GF1). */
  showTags: boolean;
  /** Unresolved targets as hollow ghost nodes (Obsidian "existing files only" = off, so shown). */
  showUnresolved: boolean;
  /** Drawings with no links (Obsidian: shown). */
  showOrphans: boolean;
  // Groups
  colourBy: "folder" | "mono";
  groups: GraphColourGroup[];
  // Display
  arrows: boolean;
  /** Zoom level at which labels start to appear (LabelLayer fadeScale). */
  textFade: number;
  /** Node size multiplier. */
  nodeSize: number;
  /** Edge thickness multiplier. */
  linkThickness: number;
  // Forces
  forces: ForceSettings;
  // Local graph
  localDepth: 1 | 2 | 3;
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: "",
  showTags: true,
  showUnresolved: true,
  showOrphans: true,
  colourBy: "folder",
  groups: [],
  arrows: false,
  textFade: 0.5,
  nodeSize: 1,
  linkThickness: 1,
  forces: { ...DEFAULT_FORCE_SETTINGS },
  localDepth: 2,
};

export type GraphMode = "global" | "local";

/** Props of the lazily loaded GraphView (src/graph/GraphView.tsx). */
export type GraphViewProps = {
  handle: string;
  /** The open drawing (accent ring; root of the local graph). */
  currentPath: string | null;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  settings: GraphSettings;
  onSettingsChange: (next: GraphSettings) => void;
  /** Open a drawing (vault-relative `.excalidraw` path) and close the graph. */
  onOpen: (path: string, target?: OpenTarget) => void;
  /** Esc / close button: back to the editor, same viewport. */
  onClose: () => void;
  /** Hotkey label of the bound `drawing.open:<path>` command, if any (hover card). */
  shortcutFor?: (path: string) => string | null;
  /** Theme generation: changes when the app theme changes, so colours are re-read from CSS variables. */
  themeKey: string;
};
