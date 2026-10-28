/**
 * Memory settings: preference fields, config.toml keys (`[memory]`),
 * validation and defaults. Pure data; settingsSync.ts / preferences.ts spread
 * `MEMORY_MAPPINGS`, `MEMORY_FIELDS` and `MEMORY_DEFAULTS` in.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const MEMORY_FIELDS = [
  "memoryFreeUnusedImages",
  "memoryUndoSteps",
  "memoryHiddenPurgeS",
  "memoryIdlePurgeS",
  "memoryLowMemoryCanvas",
] as const;
export type MemoryField = typeof MEMORY_FIELDS[number];

/** Undo steps kept per drawing: older ones are dropped, with the images only they could restore. */
export const MEMORY_UNDO_STEPS = { min: 10, max: 10000, step: 50 } as const;

/** Seconds before the purge triggers fire; 0 turns a trigger off. */
export const MEMORY_PURGE_S = { min: 0, max: 86400 } as const;
export const DEFAULT_HIDDEN_PURGE_S = 120;
export const DEFAULT_IDLE_PURGE_S = 180;

export interface MemoryPreferences {
  /** Free image data no element and no undo/redo entry can bring back. */
  memoryFreeUnusedImages: boolean;
  /** Undo horizon: steps kept per drawing. */
  memoryUndoSteps: number;
  /** Seconds hidden before every cache is purged (0 = never). */
  memoryHiddenPurgeS: number;
  /** Seconds without input, while visible, before off-screen caches are purged (0 = never). */
  memoryIdlePurgeS: number;
  /** Back the editor canvases with CPU memory: about 100 MB less memory, panning at about 60 frames/s. Read when the editor starts. */
  memoryLowMemoryCanvas: boolean;
}

export const MEMORY_DEFAULTS: MemoryPreferences = {
  memoryFreeUnusedImages: true,
  memoryUndoSteps: 1000,
  memoryHiddenPurgeS: DEFAULT_HIDDEN_PURGE_S,
  memoryIdlePurgeS: DEFAULT_IDLE_PURGE_S,
  memoryLowMemoryCanvas: false,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isSteps = (v: unknown): boolean =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= MEMORY_UNDO_STEPS.min &&
  v <= MEMORY_UNDO_STEPS.max;

const isPurgeS = (v: unknown): boolean =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= MEMORY_PURGE_S.min &&
  v <= MEMORY_PURGE_S.max;
const PURGE_EXPECTED = `a whole number from ${MEMORY_PURGE_S.min} to ${MEMORY_PURGE_S.max} (seconds, 0 = never)`;

export const MEMORY_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "memoryFreeUnusedImages",
    key: "memory.free_unused_images",
    expected: "true or false",
    valid: isBool,
  },
  {
    field: "memoryUndoSteps",
    key: "memory.undo_steps",
    expected: `a whole number from ${MEMORY_UNDO_STEPS.min} to ${MEMORY_UNDO_STEPS.max} (undo steps kept per drawing)`,
    valid: isSteps,
  },
  {
    field: "memoryHiddenPurgeS",
    key: "memory.hidden_purge_s",
    expected: PURGE_EXPECTED,
    valid: isPurgeS,
  },
  {
    field: "memoryIdlePurgeS",
    key: "memory.idle_purge_s",
    expected: PURGE_EXPECTED,
    valid: isPurgeS,
  },
  {
    field: "memoryLowMemoryCanvas",
    key: "memory.low_memory_canvas",
    expected: "true or false",
    valid: isBool,
  },
];

const VALID: Record<MemoryField, (v: unknown) => boolean> = {
  memoryFreeUnusedImages: isBool,
  memoryUndoSteps: isSteps,
  memoryHiddenPurgeS: isPurgeS,
  memoryIdlePurgeS: isPurgeS,
  memoryLowMemoryCanvas: isBool,
};

/** Stored (localStorage) preferences -> valid memory fields; bad ones default. */
export function normalizeMemoryPreferences(
  input: Record<string, unknown>,
): MemoryPreferences {
  return Object.fromEntries(
    MEMORY_FIELDS.map((field) => [
      field,
      VALID[field](input[field]) ? input[field] : MEMORY_DEFAULTS[field],
    ]),
  ) as unknown as MemoryPreferences;
}
