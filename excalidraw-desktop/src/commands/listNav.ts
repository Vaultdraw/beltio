/**
 * Keyboard lists (file tree, tags, links, Settings pages) as command targets.
 *
 * A panel registers a ListController on its focusable root. The `list.*`
 * commands (listCommands.ts) then run on the list that has focus; from the
 * palette, on the last list that had focus. A command is offered only when
 * that list implements its action, so an unimplemented key passes through
 * to the panel (or Excalidraw) untouched.
 *
 * Zero cost until a list mounts: the handler layer is bound on the first
 * registration and the keypress path is one `closest()` call.
 */
import { registerCommandHandlers } from "./handlerRegistry";

import type { CommandHandler, CommandHandlers } from "./types";

export const LIST_ACTIONS = [
  "down",
  "up",
  "first",
  "last",
  "expand",
  "collapse",
  "open",
  "select",
  "openInNewTab",
  "rename",
  "delete",
  "newItem",
  "newFolder",
  "move",
  "menu",
  "nextView",
  "exit",
  // command audit (S8): the file tree's row menu items
  "duplicate",
  "saveAsTemplate",
  "reveal",
  "showAsGrid",
  "localGraph",
  "history",
  "exportPng",
  "exportSvg",
  "exportPdf",
  "saveCopy",
  "copyPath",
  "copyAbsolutePath",
  "copyLink",
] as const;

export type ListAction = typeof LIST_ACTIONS[number];

/** What a list can do; every method is optional. */
export type ListController = Partial<Record<ListAction, () => void>>;

/** Command id of an action: "list.down", "list.openInNewTab", ... */
export const listCommandId = (action: ListAction) => `list.${action}`;

/** Attribute that marks a list root; its value names the list (e.g. "tree"). */
export const LIST_ATTR = "data-keylist";

const controllers = new WeakMap<Element, ListController>();
/** Mounted list roots, newest last (focusList, handler lifetime). */
const mounted: Element[] = [];
let lastFocused: Element | null = null;
let unbindHandlers: (() => void) | null = null;

const rootOf = (el: Element | null): Element | null =>
  el?.closest(`[${LIST_ATTR}]`) ?? null;

/**
 * The list a command acts on: the focused one, else the last one used (from
 * the palette). None used yet = no target, so the palette hides `list.*`.
 */
function target(): { root: Element; ctrl: ListController } | null {
  const doc = mounted[0]?.ownerDocument;
  const focused = rootOf(doc?.activeElement ?? null);
  const root =
    (focused && controllers.has(focused) ? focused : null) ??
    (lastFocused && controllers.has(lastFocused) ? lastFocused : null);
  const ctrl = root && controllers.get(root);
  return root && ctrl ? { root, ctrl } : null;
}

const run =
  (action: ListAction): CommandHandler =>
  () => {
    const t = target();
    if (!t) {
      return;
    }
    // From the palette, focus went elsewhere: bring it back to the list first.
    const doc = t.root.ownerDocument;
    if (!t.root.contains(doc.activeElement)) {
      (t.root as HTMLElement).focus?.();
    }
    t.ctrl[action]?.();
  };

/**
 * Getters, so availability follows focus: `handlers["list.rename"]` is
 * undefined while the target list cannot rename, and the dispatcher then
 * leaves the key alone.
 */
function makeHandlerLayer(): CommandHandlers {
  const layer: CommandHandlers = {};
  for (const action of LIST_ACTIONS) {
    const handler = run(action);
    Object.defineProperty(layer, listCommandId(action), {
      enumerable: true,
      get: () => (target()?.ctrl[action] ? handler : undefined),
    });
  }
  return layer;
}

const onFocusIn = (e: FocusEvent) => {
  const root = rootOf(e.target as Element | null);
  if (root && controllers.has(root)) {
    lastFocused = root;
  }
};

/**
 * Make `root` a keyboard list until the returned function runs. `name` is
 * the attribute value (styling, tests). The controller is read live, so pass
 * a stable object whose methods read current state (e.g. a ref's current).
 */
export function registerList(
  root: HTMLElement,
  name: string,
  controller: ListController,
): () => void {
  root.setAttribute(LIST_ATTR, name);
  controllers.set(root, controller);
  mounted.push(root);
  root.addEventListener("focusin", onFocusIn);
  if (!unbindHandlers) {
    unbindHandlers = registerCommandHandlers(makeHandlerLayer());
  }
  return () => {
    root.removeEventListener("focusin", onFocusIn);
    if (controllers.get(root) === controller) {
      controllers.delete(root);
      root.removeAttribute(LIST_ATTR);
    }
    const i = mounted.lastIndexOf(root);
    if (i >= 0) {
      mounted.splice(i, 1);
    }
    if (lastFocused === root) {
      lastFocused = null;
    }
    if (mounted.length === 0 && unbindHandlers) {
      unbindHandlers();
      unbindHandlers = null;
    }
  };
}

/** Focus the list registered as `name` (e.g. "tree"); false when none is mounted. */
export function focusList(name: string): boolean {
  for (let i = mounted.length - 1; i >= 0; i--) {
    const root = mounted[i];
    if (root.getAttribute(LIST_ATTR) === name) {
      (root as HTMLElement).focus?.();
      return true;
    }
  }
  return false;
}
