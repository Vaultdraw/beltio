/**
 * Memory commands. The handler is bound by the editor (memory/useMemoryRetention.ts);
 * a command without a handler is simply not offered.
 */
import type { CommandDefinition } from "./types";

export const MEMORY_COMMAND_IDS = {
  freeUnusedImages: "memory.freeUnusedImages",
} as const;

export const MEMORY_COMMANDS: CommandDefinition[] = [
  {
    id: MEMORY_COMMAND_IDS.freeUnusedImages,
    title: "Memory: Free unused images",
    category: "Memory",
    keys: { default: [] },
    when: ["drawingOpen", "!modalOpen"],
  },
];
