import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLaunch } from "./smoke-check.mjs";

const good = { details: { perf: { errors: [] } }, steps: [{ step: "a", ok: true }, { step: "library", ok: true }] };
const bad = { details: { perf: { errors: ["vault-open: Timed out after 60000ms waiting for root tree rows", "search: rAF stalled (window hidden/occluded?)"] } }, steps: [{ step: "perf-mark", ok: true }] };

test("clean launch passes", () => assert.deepEqual(checkLaunch({ exitCode: 0, report: good }), []));
test("tonight's false pass fails: exit 1, perf errors, stalled", () => {
  const why = checkLaunch({ exitCode: 1, report: bad }).join("|");
  assert.match(why, /exited 1/); assert.match(why, /perf errors/); assert.match(why, /INVALID/);
});
test("failed step fails", () => assert.ok(checkLaunch({ exitCode: 0, report: { ...good, steps: [{ step: "x", ok: false }] } }).length));
test("missing report or empty steps fail", () => {
  assert.ok(checkLaunch({ exitCode: 0, report: null }).length);
  assert.ok(checkLaunch({ exitCode: 0, report: { details: {}, steps: [] } }).length);
});
test("off-screen native window is INVALID", () => {
  const log = JSON.stringify({ monitor: null }) + "\n";
  assert.match(checkLaunch({ exitCode: 0, report: good, windowLog: log }).join(), /INVALID: window hidden/);
});
test("visible native window passes", () => {
  const log = JSON.stringify({ monitor: "m", mac: { occlusionVisible: true, hasScreen: true } }) + "\n";
  assert.deepEqual(checkLaunch({ exitCode: 0, report: good, windowLog: log }), []);
});
