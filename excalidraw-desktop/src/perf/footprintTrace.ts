/**
 * Memory diagnosis for perf builds only (VAULTDRAW_PERF_LAYER_DIR): samples
 * each process's footprint and lifetime peak every 50 ms through the
 * smoke-build `perf_footprint` command, and logs every rise of a lifetime
 * peak with the perf step that was running.
 */
import { invoke } from "@tauri-apps/api/core";

let step = "boot";
const lines: string[] = [];
const MB = 1048576;

/** Names the step that is running now (scenario, open of a path, save, pan). */
export function setPerfStep(name: string): void {
  step = name;
}

export function startFootprintTrace(
  win: Window,
  pids: Record<string, number | null | undefined>,
): () => void {
  const roles = Object.entries(pids).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] > 0 && entry[0] !== "network",
  );
  const roleOf = new Map(roles.map(([role, pid]) => [pid, role]));
  const lastPeak = new Map<string, number>();
  let busy = false;
  const timer = win.setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    void invoke<[number, number, number][]>("perf_footprint", {
      pids: roles.map(([, pid]) => pid),
    })
      .then((rows) => {
        const now: string[] = [];
        let rose = false;
        for (const [pid, footprint, peak] of rows) {
          const role = roleOf.get(pid) ?? String(pid);
          now.push(
            `${role}=${Math.round(footprint / MB)}/${Math.round(peak / MB)}`,
          );
          if (peak - (lastPeak.get(role) ?? 0) >= 2 * MB) {
            rose = true;
            lastPeak.set(role, peak);
          }
        }
        if (rose && lines.length < 2000) {
          lines.push(
            `${win.performance.now().toFixed(0)}ms [${step}] ${now.join(" ")}`,
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, 50);
  return () => win.clearInterval(timer);
}

/** Peak rises so far, one line each: time, step, role=now/peak MB. */
export function footprintTraceText(): string {
  return lines.join("\n");
}
