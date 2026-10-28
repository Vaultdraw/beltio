/**
 * Opening links: one `openRaw(link)` shared by Excalidraw's `onLinkOpen`
 * (shape link icon / popup), modifier+click, hint mode and "open under
 * selection". Vault links and `/...` links never reach `window.open`, which
 * would navigate the webview.
 */
import { isWebLink, openWebLink } from "../../help/openExternal";
import { findLinks, parseLinkField } from "../../links/grammar";

import type { LinkResolver } from "../../links/resolve";
import type { OpenTarget } from "../../tabs/types";
import type { Resolution } from "../../links/types";

export type LinkOpenCallbacks = {
  openDrawing(path: string, elementId?: string, target?: OpenTarget): void;
  /** The link resolves to nothing: offer "Create 'target'". */
  onUnresolved(target: string): void;
};

export type LinkOpenDeps = {
  getFromPath(): string | null;
  getResolver(): LinkResolver;
  getCallbacks(): LinkOpenCallbacks;
  /** Asked when the name list does not know the target (e.g. not loaded yet). */
  fallbackResolve?(fromPath: string, raw: string): Promise<Resolution>;
};

/** The target a link value (`[[x]]`, vaultdraw URL, `./x.excalidraw`) names. */
export function targetOf(
  raw: string | null | undefined,
): { target: string; relative: boolean } | null {
  const text = raw?.trim();
  if (!text) {
    return null;
  }
  if (text.startsWith("[[")) {
    const first = findLinks(text)[0];
    return first ? { target: first.target, relative: false } : null;
  }
  const field = parseLinkField(text);
  return field ? { target: field.target, relative: !!field.relative } : null;
}

export type LinkOpenOptions = { target?: OpenTarget };

/** Opens a link value; false when it is not a vault link. */
export function createLinkOpener(deps: LinkOpenDeps) {
  return function openRaw(raw: string, opts?: LinkOpenOptions): boolean {
    const spec = targetOf(raw);
    if (!spec) {
      return false;
    }
    const from = deps.getFromPath() ?? "";
    const done = (res: Resolution) => {
      const cb = deps.getCallbacks();
      if (res.path) {
        cb.openDrawing(res.path, undefined, opts?.target ?? "current");
      } else {
        cb.onUnresolved(spec.target);
      }
    };
    const sync = deps
      .getResolver()
      .resolveTarget(from, spec.target, spec.relative);
    if (sync.path || !deps.fallbackResolve) {
      done(sync);
    } else {
      deps.fallbackResolve(from, raw).then(done, () => done(sync));
    }
    return true;
  };
}

type LinkElement = { link?: string | null };
type NativeLinkEvent = {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};
type LinkOpenEvent = {
  preventDefault(): void;
  /** Excalidraw's wrapped event: `detail.nativeEvent` is the pointer-up. */
  detail?: { nativeEvent?: NativeLinkEvent };
};

/** Shape link icon / popup: Cmd/Ctrl+Shift or middle click -> new tab. */
export function iconLinkTarget(
  native: NativeLinkEvent | undefined,
): OpenTarget {
  if (!native) {
    return "current";
  }
  const mod = !!(native.metaKey || native.ctrlKey);
  return native.button === 1 || (mod && !!native.shiftKey) ? "new" : "current";
}

/**
 * The handler for `<Excalidraw onLinkOpen>`. Web links go to the default browser through the
 * native opener: Excalidraw's own `window.open(_blank)` does nothing in the desktop webview.
 */
export function createOnLinkOpen(
  openRaw: (raw: string, opts?: LinkOpenOptions) => boolean,
  openWeb: (url: string) => unknown = openWebLink,
) {
  return (element: LinkElement, event: LinkOpenEvent): void => {
    const link = element.link;
    if (!link) {
      return;
    }
    if (targetOf(link)) {
      event.preventDefault();
      openRaw(link, { target: iconLinkTarget(event.detail?.nativeEvent) });
    } else if (link.startsWith("/")) {
      event.preventDefault();
    } else if (isWebLink(link)) {
      event.preventDefault();
      openWeb(link.trim());
    }
  };
}
