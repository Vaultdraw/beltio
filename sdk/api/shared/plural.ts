/**
 * "1 note", "2 notes": every user message that prints a count goes through this (test-net TN-10:
 * "Imported 1 notes and 1 drawings"). Guarded by `excalidraw-desktop/src/tests/plural.guard.test.ts`.
 */
export const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
