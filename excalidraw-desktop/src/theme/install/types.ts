/**
 * The install API. The UI only talks to an `InstallBackend`; it never builds
 * URLs itself, so a theme browser can call `fetch` with an index entry.
 */

export type FetchRef =
  | { kind: "url"; url: string }
  | {
      kind: "repo";
      owner: string;
      repo: string;
      commit: string;
      path: string;
    };

/** Where an installed theme came from (stored as source.json next to it). */
export interface ThemeSource {
  url?: string;
  repo?: string;
  path?: string;
  commit?: string;
  /** Branch, tag or commit a repo theme was installed from; updates follow it. */
  ref?: string;
  sha256: string;
  installed?: string;
}

export interface RepoTheme {
  name: string;
  path: string;
}

export type Resolved =
  | { kind: "file"; name: string; json: string; sha256: string; url: string }
  | {
      kind: "repo";
      owner: string;
      repo: string;
      commit: string;
      /** What was asked for (`HEAD` = the default branch). */
      ref?: string;
      themes: RepoTheme[];
    };

export interface Fetched {
  json: string;
  sha256: string;
  url: string;
}

export interface WriteRequest {
  name: string;
  json: string;
  source: ThemeSource;
  replace: boolean;
}

export interface InstalledTheme {
  name: string;
  source: ThemeSource;
}

export interface UpdateFetch {
  changed: boolean;
  json?: string;
  sha256: string;
  commit?: string;
}

export interface InstallBackend {
  resolve(input: string, maxBytes: number): Promise<Resolved>;
  fetch(ref: FetchRef, maxBytes: number): Promise<Fetched>;
  write(request: WriteRequest): Promise<{ name: string }>;
  installed(): Promise<InstalledTheme[]>;
  updateFetch(name: string, maxBytes: number): Promise<UpdateFetch>;
  uninstall(name: string): Promise<void>;
}

/** An install failure with a stable code (THEME_EXISTS, NETWORK_NOT_ALLOWED, ...). */
export class InstallError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/** Turns a Tauri rejection ({ code, message }), an Error or a string into an InstallError. */
export const toInstallError = (err: unknown): InstallError => {
  if (err instanceof InstallError) {
    return err;
  }
  if (err && typeof err === "object" && "message" in err) {
    const { code, message } = err as { code?: unknown; message?: unknown };
    return new InstallError(
      typeof code === "string" ? code : "ERROR",
      String(message),
    );
  }
  return new InstallError("ERROR", String(err));
};
