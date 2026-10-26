/**
 * Extension bisect across restarts, as in VS Code: half of the suspects are
 * turned off, the app restarts, the user says whether the problem is still
 * there, and the half that holds the culprit is kept, until one is left.
 * Pure step logic; the state lives in the launch file (Rust, `launch.rs`),
 * and this launch's state arrives with the settings (`bisect`).
 */

export interface BisectState {
  /** Everything that was on when the bisect started. */
  candidates: string[];
  /** The culprit is one of these. */
  suspects: string[];
  /** Off during this launch: the first half of the suspects. */
  off: string[];
  /** 1 for the first restart. */
  step: number;
}

export type BisectAnswer = "gone" | "still";

export type BisectNext =
  | { kind: "continue"; state: BisectState }
  /** One suspect left: it causes the problem. */
  | { kind: "found"; id: string }
  /** The problem stayed with every suspect on: not an extension. */
  | { kind: "none" };

/** Ceiling of log2: restarts a bisect of `n` candidates needs at most. */
export const stepsFor = (n: number): number =>
  n <= 1 ? 0 : Math.ceil(Math.log2(n));

const halve = (suspects: readonly string[]): string[] =>
  suspects.slice(0, Math.ceil(suspects.length / 2));

/** A new bisect over `candidates` (null when there is nothing to bisect). */
export function startBisect(candidates: readonly string[]): BisectState | null {
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    return null;
  }
  return { candidates: unique, suspects: unique, off: halve(unique), step: 1 };
}

/**
 * The next step after the user's answer for this launch: "gone" means the
 * culprit is among those off, "still" means it is among those still on.
 */
export function answerBisect(
  state: BisectState,
  answer: BisectAnswer,
): BisectNext {
  const off = new Set(state.off);
  const suspects =
    answer === "gone"
      ? state.suspects.filter((id) => off.has(id))
      : state.suspects.filter((id) => !off.has(id));
  if (suspects.length === 0) {
    return { kind: "none" };
  }
  if (suspects.length === 1) {
    // With one left and it was off while the problem went away: found. With
    // one left that stayed on through a "still" answer, it is the only
    // suspect, but the problem may not be an extension: one more step
    // (it alone off) tells them apart.
    if (answer === "gone") {
      return { kind: "found", id: suspects[0] };
    }
    return {
      kind: "continue",
      state: { ...state, suspects, off: suspects, step: state.step + 1 },
    };
  }
  return {
    kind: "continue",
    state: { ...state, suspects, off: halve(suspects), step: state.step + 1 },
  };
}
