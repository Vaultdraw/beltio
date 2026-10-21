/**
 * Frame statistics for the refresh-rate probe. Pure: no DOM, unit tested.
 *
 * A pass records one entry per requestAnimationFrame callback: its timestamp,
 * the static-canvas renders since the previous callback, and the input events
 * since the previous callback. "fps" is how often WebKit ran a rendering
 * update; "renderHz" is how often one of those updates carried a new scene
 * render, i.e. the motion rate the eye actually sees.
 */

export type FrameSample = {
  /** rAF timestamp, ms */
  t: number;
  /** static-canvas renders since the previous frame */
  renders: number;
  /** input events (wheel / gesturechange) since the previous frame */
  inputs: number;
  /** script time of the static renders since the previous frame, ms */
  scriptMs?: number;
};

export type PassStats = {
  frames: number;
  durationMs: number;
  /** rendering updates per second */
  fps: number;
  /** frames per second that showed a new static-canvas render */
  renderHz: number;
  /** static-canvas renders per second (several in one frame count separately) */
  rendersPerSec: number;
  /** input events per second that reached the page */
  inputHz: number;
  /** frames per second whose interval received input: the most frames the
   * input itself can move (a frame without new input has nothing new to
   * show), so renderHz below it is ours, renderHz below 120 but at it is the
   * input's timing */
  inputFrameHz: number;
  intervalP50: number;
  intervalP95: number;
  /** share of intervals <= 9 ms (one 120 Hz vsync) */
  framesLe9msPct: number;
  /** intervals by whole display periods: 1 (on time), 2 (one missed), 3, 4+ */
  vsyncBuckets: { one: number; two: number; three: number; fourPlus: number };
  /** display periods with no rendering update */
  droppedFrames: number;
  /** frames that drew the scene more than once (wasted work) */
  multiRenderFrames: number;
  /** frames that drew nothing although input arrived in that interval */
  inputWithoutRenderFrames: number;
  /** static-render script time per frame (frames that rendered), ms */
  scriptMsP50: number;
  scriptMsP95: number;
  /** share of the pass spent in static-render script */
  scriptBusyPct: number;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) {
    return 0;
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
};

/** Statistics over `samples` (in timestamp order). `displayHz` is the screen's refresh rate. */
export function passStats(
  samples: FrameSample[],
  displayHz: number,
): PassStats {
  const period = 1000 / (displayHz > 0 ? displayHz : 60);
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    intervals.push(samples[i].t - samples[i - 1].t);
  }
  const durationMs =
    samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
  const perSec = (count: number) =>
    durationMs > 0 ? round1((count * 1000) / durationMs) : 0;
  // The first sample's counters cover the time before the pass started.
  const counted = samples.slice(1);
  const buckets = { one: 0, two: 0, three: 0, fourPlus: 0 };
  let dropped = 0;
  for (const interval of intervals) {
    const periods = Math.max(1, Math.round(interval / period));
    dropped += periods - 1;
    if (periods === 1) {
      buckets.one++;
    } else if (periods === 2) {
      buckets.two++;
    } else if (periods === 3) {
      buckets.three++;
    } else {
      buckets.fourPlus++;
    }
  }
  const pct = (n: number) =>
    intervals.length ? round1((n * 100) / intervals.length) : 0;
  const sorted = [...intervals].sort((a, b) => a - b);
  const script = counted
    .filter((s) => s.renders > 0)
    .map((s) => s.scriptMs ?? 0)
    .sort((a, b) => a - b);
  const scriptTotal = counted.reduce((sum, s) => sum + (s.scriptMs ?? 0), 0);
  return {
    frames: samples.length,
    durationMs: round1(durationMs),
    fps: perSec(intervals.length),
    renderHz: perSec(counted.filter((s) => s.renders > 0).length),
    rendersPerSec: perSec(counted.reduce((sum, s) => sum + s.renders, 0)),
    inputHz: perSec(counted.reduce((sum, s) => sum + s.inputs, 0)),
    inputFrameHz: perSec(counted.filter((s) => s.inputs > 0).length),
    intervalP50: round1(percentile(sorted, 50)),
    intervalP95: round1(percentile(sorted, 95)),
    framesLe9msPct: pct(intervals.filter((x) => x <= 9).length),
    vsyncBuckets: {
      one: pct(buckets.one),
      two: pct(buckets.two),
      three: pct(buckets.three),
      fourPlus: pct(buckets.fourPlus),
    },
    droppedFrames: dropped,
    multiRenderFrames: counted.filter((s) => s.renders > 1).length,
    inputWithoutRenderFrames: counted.filter(
      (s) => s.inputs > 0 && s.renders === 0,
    ).length,
    scriptMsP50: round1(percentile(script, 50)),
    scriptMsP95: round1(percentile(script, 95)),
    scriptBusyPct:
      durationMs > 0 ? round1((scriptTotal * 100) / durationMs) : 0,
  };
}
