import { API } from "../tests/helpers/api";

import { loadFromBlob, loadFromJSONText } from "./blob";
import { serializeAsJSON } from "./json";

describe("loadFromJSONText", () => {
  it("restores a scene exactly like loadFromBlob", async () => {
    const elements = [
      API.createElement({ type: "rectangle", id: "r" }),
      API.createElement({ type: "text", id: "t", text: "hi" }),
    ];
    const json = serializeAsJSON(
      elements,
      { viewBackgroundColor: "#123456" } as any,
      {},
      "local",
    );
    const fromBlob = await loadFromBlob(
      new Blob([json], { type: "application/json" }),
      null,
      null,
      null,
    );
    const fromText = loadFromJSONText(json, null, null);
    // restore draws fresh random version nonces; everything else is equal
    const withoutNonce = (scene: typeof fromBlob) => ({
      ...scene,
      elements: scene.elements.map(({ versionNonce, ...rest }) => rest),
    });
    expect(withoutNonce(fromText)).toEqual(withoutNonce(fromBlob));
    expect(fromText.appState.viewBackgroundColor).toBe("#123456");
  });

  it("rejects text that is not a scene", () => {
    expect(() => loadFromJSONText("{ nope", null, null)).toThrow();
    expect(() => loadFromJSONText('{"type":"other"}', null, null)).toThrow();
  });
});
