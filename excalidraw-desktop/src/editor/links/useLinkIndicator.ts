/**
 * The canvas marker of linked elements (links.canvas_indicator, links.color):
 * resolves the colour for the current theme and keeps it fresh when the
 * accent changes. Returns the value for the editor's `linkIndicator` prop.
 */
import { useEffect, useMemo, useState } from "react";

import { applyDarkModeFilter } from "@excalidraw/common";

import { normalizeHex } from "../../theme/color";
import { getPreferences } from "../../vault/preferences";
import { useLinkDisplayPrefs } from "../../links/useLinkDisplayPrefs";

import { FALLBACK_ACCENT } from "./style/linkStyler";

import type { LinkIndicator } from "../../links/types";

const ACCENT_VAR = "--vault-primary";

export type LinkIndicatorProp = { style: LinkIndicator; color: string };

const readAccent = (): string =>
  (typeof document !== "undefined" &&
    document.documentElement.style.getPropertyValue(ACCENT_VAR).trim()) ||
  FALLBACK_ACCENT;

/** The marker colour: the theme accent, or a fixed colour adapted to dark mode. */
export const resolveLinkIndicatorColor = (
  linkColor: string,
  accent: string,
  isDark: boolean,
): string => {
  if (linkColor === "accent") {
    return accent;
  }
  const hex = normalizeHex(linkColor);
  return hex ? applyDarkModeFilter(hex, isDark) : accent;
};

export function useLinkIndicator(
  theme: string,
  win?: Window | null,
): LinkIndicatorProp {
  useLinkDisplayPrefs(win);
  const prefs = getPreferences(win);
  const [accent, setAccent] = useState(readAccent);
  const followsAccent = prefs.linkColor === "accent";
  useEffect(() => {
    if (!followsAccent || typeof MutationObserver === "undefined") {
      return undefined;
    }
    setAccent(readAccent());
    const observer = new MutationObserver(() => setAccent(readAccent()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [followsAccent]);
  const style = prefs.linkCanvasIndicator;
  const color = resolveLinkIndicatorColor(
    prefs.linkColor,
    accent,
    theme === "dark",
  );
  return useMemo(() => ({ style, color }), [style, color]);
}
