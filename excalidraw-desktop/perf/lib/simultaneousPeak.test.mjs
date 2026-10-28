import test from "node:test";
import assert from "node:assert/strict";
import { createPeakTracker, peakNote } from "./simultaneousPeak.mjs";

const MB = 1024 * 1024;
const sample = (web, gpu) => new Map([[1, { footprint: web * MB }], [2, { footprint: gpu * MB }]]);
const roles = (pid) => (pid === 1 ? "web" : "gpu");

test("simultaneous peak is below the sum of individual peaks", () => {
  const t = createPeakTracker(roles);
  t.add(sample(300, 20), "phase:open");
  t.add(sample(250, 110), "phase:pan");
  t.add(sample(260, 30), "phase:idle");
  const s = t.summary();
  assert.equal(s.peakMB, 360); // web 250 + gpu 110; the sum of peaks would be 300 + 110 = 410
  assert.equal(s.peakLabel, "phase:pan");
  assert.deepEqual(s.perRoleMaxMB, { web: 300, gpu: 110 });
  assert.deepEqual(s.perLabelMB, { "phase:open": 320, "phase:pan": 360, "phase:idle": 290 });
  assert.match(peakNote(s), /simultaneous whole-app peak 360 MB at "phase:pan"/);
});

test("empty and non-finite samples are ignored", () => {
  const t = createPeakTracker(roles);
  t.add(new Map(), "x");
  t.add(new Map([[1, { footprint: NaN }]]), "x");
  assert.equal(t.summary().peakMB, 0);
  assert.equal(peakNote(createPeakTracker().summary()), "simultaneous peak: no footprint samples");
});
