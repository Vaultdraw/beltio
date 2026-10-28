/**
 * Plugin paste handlers (`ctx.clipboard.onPaste`, API 0.28.0). The editor asks `routePaste` for every
 * paste of plain text; with no handler registered and no plugin that wants one, that is a single
 * `includes("\n")` and a Set size check. A plugin that declares `activation = ["onPaste"]` (or an
 * official one with `pasteHook`) is started by the first multi-line paste, so nothing loads at launch.
 */
export type PasteHandlerResult = "handled" | "pass" | void;
export type PasteHandler = (event: {
  text: string;
}) => PasteHandlerResult | Promise<PasteHandlerResult>;

export const PASTE_TIMEOUT_MS = 1500;

const handlers = new Set<{ pluginId: string; run: PasteHandler }>();
let starter: (() => Promise<void>) | null = null;

/** The host sets this: it starts the plugins that want pastes (once; later calls are instant). */
export const setPasteStarter = (fn: (() => Promise<void>) | null): void => {
  starter = fn;
};

export function addPasteHandler(
  pluginId: string,
  run: PasteHandler,
): () => void {
  const entry = { pluginId, run };
  handlers.add(entry);
  return () => {
    handlers.delete(entry);
  };
}

export const pasteHandlerCount = (): number => handlers.size;

const within = <T>(work: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });

/** True when a plugin handled the paste (the editor then skips its own). Never throws. */
export async function routePaste(text: string): Promise<boolean> {
  if (!text.includes("\n")) {
    return false;
  }
  if (handlers.size === 0 && starter) {
    await within(starter(), PASTE_TIMEOUT_MS);
  }
  for (const h of [...handlers]) {
    const result = await within(
      Promise.resolve().then(() => h.run({ text })),
      PASTE_TIMEOUT_MS,
    );
    if (result === "handled") {
      return true;
    }
  }
  return false;
}
