import type { VaultEntry, VaultRepository } from "./types";

/**
 * The root listing of a vault, started before the app shell mounts.
 *
 * Opening a vault used to mount the shell first and only then, from an effect
 * that runs after every child's effects, ask for the root listing: the tree
 * rows came one render and one frame later (about 20 ms at 4x CPU). Starting
 * the listing first lets it run while the shell renders, and when it answers
 * quickly the rows go into the same first render as the shell.
 */
export interface RootPrime {
  handle: string;
  /** The vault generation the listing belongs to. */
  gen: number;
  items: Promise<VaultEntry[]>;
  /** The items are already in the directory map: don't list the root again. */
  applied: boolean;
}

/** How long opening a vault waits for the root listing before showing the shell without it. */
export const ROOT_PRIME_WAIT_MS = 32;

export function startRootPrime(
  repository: Pick<VaultRepository, "listDirectory">,
  handle: string,
  gen: number,
): RootPrime {
  const items = repository.listDirectory(handle, "");
  // A failure is reported by whoever awaits it (the vault effect), never here.
  items.catch(() => {});
  return { handle, gen, items, applied: false };
}

/** The listing if it arrives within `ms`, else null (also null on failure). */
export function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** The prime for this vault and generation, if any; a prime is used once. */
export function takeRootPrime(
  ref: { current: RootPrime | null },
  handle: string,
  gen: number,
): RootPrime | null {
  const prime = ref.current;
  ref.current = null;
  return prime && prime.handle === handle && prime.gen === gen ? prime : null;
}
