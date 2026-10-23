/**
 * Memory settings: preference fields, config.toml keys (`[memory]`),
 * validation and defaults. Pure data; settingsSync.ts / preferences.ts spread
 * `MEMORY_MAPPINGS`, `MEMORY_FIELDS` and `MEMORY_DEFAULTS` in.
 */
import type { ConfigMapping } from "../vault/settingsSync";

export const MEMORY_FIELDS = ["memoryFreeUnusedImages", "memoryUndoSteps"] as const;
export type MemoryField = typeof MEMORY_FIELDS[number];

/** Undo steps kept per drawing: older ones are dropped, with the images only they could restore. */
export const MEMORY_UNDO_STEPS = { min: 10, max: 10000, step: 50 } as const;

export interface MemoryPreferences {
  /** Free image data no element and no undo/redo entry can bring back. */
  memoryFreeUnusedImages: boolean;
  /** Undo horizon: steps kept per drawing. */
  memoryUndoSteps: number;
}

export const MEMORY_DEFAULTS: MemoryPreferences = {
  memoryFreeUnusedImages: true,
  memoryUndoSteps: 1000,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isSteps = (v: unknown): boolean =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= MEMORY_UNDO_STEPS.min &&
  v <= MEMORY_UNDO_STEPS.max;

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
];

const VALID: Record<MemoryField, (v: unknown) => boolean> = {
  memoryFreeUnusedImages: isBool,
  memoryUndoSteps: isSteps,
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
