/** The two restart commands in Rust (`launch.rs`). */
const call = async (cmd: string) =>
  (await import("@tauri-apps/api/core")).invoke(cmd);

/** Quit through the normal save path, then start again in safe start (core only). */
export const restartSafeStart = (): Promise<unknown> =>
  call("app_restart_safe");

/** Quit through the normal save path, then start again normally. */
export const restartNormally = (): Promise<unknown> =>
  call("app_restart_normally");
