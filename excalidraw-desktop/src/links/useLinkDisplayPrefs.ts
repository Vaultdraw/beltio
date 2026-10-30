/**
 * Re-renders the caller when a link display preference (style_links, color,
 * hover_preview) changes from outside the Settings page, e.g. the palette's
 * toggle commands. Preferences are read only when they are written, and
 * other preference writes leave the key unchanged (React bails out).
 */
import { useEffect, useState } from "react";

import { getPreferences, subscribePreferences } from "../vault/preferences";

const keyOf = (win?: Window | null) => {
  const p = getPreferences(win);
  return `${p.linkStyle}|${p.linkColor}|${p.linkHoverPreview}|${p.linkCanvasIndicator}`;
};

export function useLinkDisplayPrefs(win?: Window | null): void {
  const [, setKey] = useState(() => keyOf(win));
  useEffect(() => subscribePreferences(() => setKey(keyOf(win))), [win]);
}
