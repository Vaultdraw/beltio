import test from "node:test";
import assert from "node:assert/strict";
import { parseWindowStateLog, windowSummary } from "./windowState.mjs";

const onScreen = { monitor: "Built-in", mac: { isVisible: true, occlusionVisible: true, hasScreen: true } };
const parked = { monitor: null, mac: { isVisible: true, occlusionVisible: false, hasScreen: false } };

test("parseWindowStateLog skips blank and partial lines", () => {
  const text = `${JSON.stringify(onScreen)}\n\n${JSON.stringify(parked)}\n{"monitor":`;
  assert.deepEqual(parseWindowStateLog(text), [onScreen, parked]);
  assert.deepEqual(parseWindowStateLog(undefined), []);
});

test("a visible run is not hidden", () => {
  const s = windowSummary({ visibilities: ["visible", "visible"], native: [onScreen] });
  assert.equal(s.hidden, false);
  assert.equal(s.known, true);
});

test("page hidden, off-screen or occluded each mark the run hidden", () => {
  assert.equal(windowSummary({ visibilities: ["visible", "hidden"] }).hidden, true);
  const off = windowSummary({ native: [onScreen, parked] });
  assert.equal(off.hidden, true);
  assert.equal(off.offScreenSamples, 1);
  assert.equal(off.occludedSamples, 1);
  const occluded = { monitor: "Built-in", mac: { ...onScreen.mac, occlusionVisible: false } };
  assert.equal(windowSummary({ native: [occluded] }).hidden, true);
});

test("no signals: unknown, not hidden", () => {
  const s = windowSummary();
  assert.equal(s.hidden, false);
  assert.equal(s.known, false);
});
