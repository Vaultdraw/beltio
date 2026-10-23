/** Which perf scenarios run. `only` is an allow-list, `skip` a deny-list; both empty/absent = all. */
export type ScenarioFilter = { only?: string[]; skip?: string[] };

/** Every other scenario needs the vault open, so it always runs. */
export const ALWAYS_RUN = "vault-open";

export const parseScenarioList = (
  value: string | null | undefined,
): string[] | undefined => {
  const list = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
};

export const scenarioSelected = (
  name: string,
  filter?: ScenarioFilter,
): boolean => {
  if (!filter || name === ALWAYS_RUN) {
    return true;
  }
  if (filter.skip?.includes(name)) {
    return false;
  }
  return !filter.only || filter.only.includes(name);
};
