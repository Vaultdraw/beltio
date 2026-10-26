/**
 * The open vault's appearance overrides (theme, mode, accent) for
 * useAppearance. While the vault's settings.toml is still loading, the last
 * overrides seen for that vault are used, so a vault with its own theme does
 * not first paint in the global one. The cache is a small localStorage entry
 * (a convenience: losing it only brings the flash back).
 */
import { useEffect, useMemo } from "react";

import type { VaultAppearance } from "../vault/useAppearance";
import type { UseVaultSettings } from "../vault/useVaultSettings";

const KEY = "vaultdraw.vaultAppearance.v1";
const MAX_VAULTS = 32;

type Cache = Record<string, VaultAppearance>;

const read = (win: Window | null): Cache => {
  try {
    const raw = win?.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    return {};
  }
};

const write = (win: Window | null, handle: string, value: VaultAppearance) => {
  try {
    const cache = read(win);
    const empty = Object.keys(value).length === 0;
    if (
      empty
        ? !(handle in cache)
        : JSON.stringify(cache[handle]) === JSON.stringify(value)
    ) {
      return;
    }
    delete cache[handle];
    if (!empty) {
      cache[handle] = value;
    }
    const names = Object.keys(cache);
    for (const name of names.slice(0, Math.max(0, names.length - MAX_VAULTS))) {
      delete cache[name];
    }
    win?.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode or full storage: no cache, no harm.
  }
};

const pick = (o: UseVaultSettings["overrides"]): VaultAppearance => {
  const out: VaultAppearance = {};
  if (o.colorTheme !== undefined) {
    out.colorTheme = o.colorTheme;
  }
  if (o.theme !== undefined) {
    out.theme = o.theme;
  }
  if (o.accentColor !== undefined) {
    out.accentColor = o.accentColor;
  }
  return out;
};

export function useVaultAppearance(
  win: Window | null,
  handle: string | null,
  vaultSettings: Pick<UseVaultSettings, "overrides" | "loaded">,
): VaultAppearance {
  const { overrides, loaded } = vaultSettings;
  const live = useMemo(() => pick(overrides), [overrides]);
  const cached = useMemo(
    () => (handle && !loaded ? read(win)[handle] ?? {} : {}),
    [win, handle, loaded],
  );
  useEffect(() => {
    if (handle && loaded) {
      write(win, handle, live);
    }
  }, [win, handle, loaded, live]);
  return loaded ? live : cached;
}
