/**
 * Per-plugin cost accounting for the Installed tab and the perf harness.
 * Wrapped calls pay two performance.now reads; marks are named
 * `vaultdraw:plugin:<id>:load|activate`.
 */
export const SLOW_HANDLER_MS = 50;
const RING = 50;
const MEMORY_FACTOR = 6;

export interface PluginCost {
  id: string;
  loadMs: number | null;
  activateMs: number | null;
  /** Last 50 handler durations (ms, synchronous part). */
  handlerMs: number[];
  slowCount: number;
  registrations: { commands: number; panels: number; settings: number };
  mainBytes: number;
  /** Rough resident estimate: mainBytes x 6 once loaded. */
  estimatedBytes: number;
  /** Native calls through the gateway, per method (time includes the round trip). */
  gateway: Record<string, GatewayCost>;
}

export interface GatewayCost {
  calls: number;
  totalMs: number;
  /** Bytes sent (request text the host already had at hand, such as storage writes). */
  bytes: number;
  slowCount: number;
}

const costs = new Map<string, PluginCost>();
let stubRegistrationMs = 0;

const entry = (id: string): PluginCost => {
  let c = costs.get(id);
  if (!c) {
    c = {
      id,
      loadMs: null,
      activateMs: null,
      handlerMs: [],
      slowCount: 0,
      registrations: { commands: 0, panels: 0, settings: 0 },
      mainBytes: 0,
      estimatedBytes: 0,
      gateway: {},
    };
    costs.set(id, c);
  }
  return c;
};

export function setRegistrationCounts(
  id: string,
  registrations: PluginCost["registrations"],
  mainBytes: number,
): void {
  const c = entry(id);
  c.registrations = registrations;
  c.mainBytes = mainBytes;
}

export function recordLoad(id: string, ms: number, start: number): void {
  const c = entry(id);
  c.loadMs = ms;
  c.estimatedBytes = c.mainBytes * MEMORY_FACTOR;
  measure(id, "load", start, ms);
}

export function recordActivate(id: string, ms: number, start: number): void {
  entry(id).activateMs = ms;
  measure(id, "activate", start, ms);
}

export function recordHandler(id: string, ms: number): void {
  const c = entry(id);
  if (c.handlerMs.length >= RING) {
    c.handlerMs.shift();
  }
  c.handlerMs.push(ms);
  if (ms > SLOW_HANDLER_MS) {
    c.slowCount++;
  }
}

export function recordGatewayCall(
  id: string,
  method: string,
  ms: number,
  bytes: number,
): void {
  const g = entry(id).gateway;
  const m = (g[method] ??= { calls: 0, totalMs: 0, bytes: 0, slowCount: 0 });
  m.calls++;
  m.totalMs += ms;
  m.bytes += bytes;
  if (ms > SLOW_HANDLER_MS) {
    m.slowCount++;
  }
}

function measure(id: string, what: string, start: number, ms: number): void {
  try {
    performance.measure(`vaultdraw:plugin:${id}:${what}`, {
      start,
      duration: ms,
    });
  } catch {
    // measure options unsupported: the cost record still holds the number.
  }
}

export const recordStubRegistration = (ms: number): void => {
  stubRegistrationMs = ms;
};
export const getStubRegistrationMs = (): number => stubRegistrationMs;
export const getPluginCosts = (): PluginCost[] =>
  [...costs.values()].map((c) => ({
    ...c,
    handlerMs: [...c.handlerMs],
    gateway: Object.fromEntries(
      Object.entries(c.gateway).map(([k, v]) => [k, { ...v }]),
    ),
  }));
export const getPluginCost = (id: string): PluginCost | undefined =>
  costs.get(id);

export function resetCosts(): void {
  costs.clear();
  stubRegistrationMs = 0;
}
