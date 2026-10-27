/**
 * Zero startup cost: the bridge only knows these thin handlers. The first
 * scene call loads `sceneMethods` (and with it the scene core) with one
 * dynamic import; every later call reuses the same module and method table.
 */
type Handler = (params: unknown) => unknown;

export const SCENE_METHOD_NAMES = [
  "scene.read",
  "scene.get",
  "scene.selection",
  "scene.apply",
  "scene.onFile",
] as const;

const loadDefault = (): Promise<Record<string, Handler>> =>
  import("./sceneMethods").then((m) => m.createSceneMethods());

export function createLazySceneMethods(
  load: () => Promise<Record<string, Handler>> = loadDefault,
): Record<string, Handler> {
  let loaded: Promise<Record<string, Handler>> | null = null;
  const methods = () => {
    loaded ??= load().catch((e) => {
      loaded = null; // a failed chunk load may succeed on the next call
      throw e;
    });
    return loaded;
  };
  const out: Record<string, Handler> = {};
  for (const name of SCENE_METHOD_NAMES) {
    out[name] = async (params) => (await methods())[name](params);
  }
  return out;
}
