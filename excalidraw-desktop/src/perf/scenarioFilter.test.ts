import { parseScenarioList, scenarioSelected } from "./scenarioFilter";

describe("perf scenario filter", () => {
  it("runs everything without a filter", () => {
    expect(scenarioSelected("switch")).toBe(true);
    expect(scenarioSelected("switch", {})).toBe(true);
  });

  it("allow-list runs only the listed scenarios", () => {
    const filter = { only: ["open", "save"] };
    expect(scenarioSelected("open", filter)).toBe(true);
    expect(scenarioSelected("switch", filter)).toBe(false);
  });

  it("deny-list skips the listed scenarios", () => {
    const filter = { skip: ["switch"] };
    expect(scenarioSelected("switch", filter)).toBe(false);
    expect(scenarioSelected("open", filter)).toBe(true);
  });

  it("never skips vault-open", () => {
    expect(scenarioSelected("vault-open", { only: ["open"] })).toBe(true);
    expect(scenarioSelected("vault-open", { skip: ["vault-open"] })).toBe(true);
  });

  it("parses comma lists", () => {
    expect(parseScenarioList("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(parseScenarioList("")).toBeUndefined();
    expect(parseScenarioList(null)).toBeUndefined();
  });
});
