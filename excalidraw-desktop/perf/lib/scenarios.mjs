// Scenario sets for like-for-like comparisons. The Chromium harness page runs all scenarios in one page and
// reports `scenarioMs.<name>` per scenario that ran; whole-run CPU time and counts (browser.cpu.*, browser.count.*)
// add up every scenario, so a scenario only one side has looks like a regression. ab.mjs therefore runs the head
// with only the scenarios the base ran.

const PREFIX = "scenarioMs.";

/** "a, b,,c" -> ["a","b","c"]; empty or missing -> undefined. */
export function parseScenarioList(value) {
  const list = String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/** Scenario names from a runBrowser info object (keys scenarioMs.<name>), in run order. */
export function scenarioNames(info) {
  return Object.keys(info ?? {}).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}

/**
 * The scenarios a base run reported -> allow-list for the head, or undefined when the base reported none
 * (then nothing is filtered: better a confounded comparison than a head that runs nothing).
 */
export function headScenarioFilter(baseScenarios) {
  return baseScenarios?.length ? [...baseScenarios] : undefined;
}

/** Notes on scenario-set differences after both sides ran: what the head skipped and what only the base ran. */
export function scenarioNotes({ base, head, filtered, manual = false, headFilter }) {
  const notes = [];
  const inBase = new Set(base ?? []);
  const inHead = new Set(head ?? []);
  const baseOnly = [...inBase].filter((n) => !inHead.has(n));
  const headOnly = [...inHead].filter((n) => !inBase.has(n));
  if (filtered && manual) notes.push(`NOT like-for-like: head ran only ${(headFilter ?? []).join(", ")} (--scenarios); the base ran all its scenarios, so whole-run CPU time and counts are not comparable`);
  else if (filtered) notes.push(`like-for-like: head ran only the base's scenarios (${[...inBase].join(", ")})`);
  if (headOnly.length) notes.push(`scenarios only in head (their CPU time and counts are in the totals): ${headOnly.join(", ")}`);
  if (baseOnly.length) notes.push(`scenarios only in base (the base cannot skip them; its totals include them): ${baseOnly.join(", ")}`);
  return notes;
}
