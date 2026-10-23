/**
 * Where Vaultdraw keeps its files: the same ladder as `vaultdraw-protocol` `dirs.rs`.
 *
 * - config: `$VAULTDRAW_CONFIG_DIR`, else `$XDG_CONFIG_HOME/vaultdraw`, else `~/.config/vaultdraw`
 * - state:  `$VAULTDRAW_STATE_DIR`, else `$XDG_STATE_HOME/vaultdraw`, else `~/.local/state/vaultdraw`
 * - Windows: `%APPDATA%\Vaultdraw` and `%LOCALAPPDATA%\Vaultdraw`
 *
 * Empty variables count as unset; relative XDG values are ignored; a relative override is an error.
 */
import path from "node:path";

export class EnvError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "EnvError";
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {boolean} [windows]
 * @returns {{ config: string, state: string, configOverridden: boolean }}
 */
export function resolveDirs(env, windows = process.platform === "win32") {
  const pathMod = windows ? path.win32 : path;
  /** @param {string} name */
  const v = (name) => (env[name] ? env[name] : undefined);
  /** @param {string} name */
  const abs = (name) => {
    const p = v(name);
    return p && pathMod.isAbsolute(p) ? p : undefined;
  };
  /**
   * @param {string} override
   * @param {string} xdg
   * @param {string} rel
   * @param {string} win
   */
  const resolve = (override, xdg, rel, win) => {
    const o = v(override);
    if (o !== undefined) {
      if (!pathMod.isAbsolute(o)) {
        throw new EnvError(`${override} must be an absolute path`);
      }
      return o;
    }
    if (windows) {
      const base = abs(win);
      if (!base) {
        throw new EnvError(`%${win}% is not set`);
      }
      return pathMod.join(base, "Vaultdraw");
    }
    const x = abs(xdg);
    if (x) {
      return pathMod.join(x, "vaultdraw");
    }
    const home = abs("HOME");
    if (!home) {
      throw new EnvError(
        "Cannot determine the home directory ($HOME is not set)",
      );
    }
    return pathMod.join(home, rel, "vaultdraw");
  };
  return {
    config: resolve(
      "VAULTDRAW_CONFIG_DIR",
      "XDG_CONFIG_HOME",
      ".config",
      "APPDATA",
    ),
    state: resolve(
      "VAULTDRAW_STATE_DIR",
      "XDG_STATE_HOME",
      ".local/state",
      "LOCALAPPDATA",
    ),
    configOverridden: v("VAULTDRAW_CONFIG_DIR") !== undefined,
  };
}
