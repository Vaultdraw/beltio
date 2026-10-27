/**
 * `ctx.diagrams`: the editor's Mermaid-to-Excalidraw converter for plugins. The converter chunk
 * (the same one the paste handler and the Mermaid dialog use) loads on the first call, and only
 * while Mermaid is on: with it off nothing loads and the call is refused.
 */
import { getExtensions } from "../../extensionSwitches/useExtensions";

import { skeletonsToOps } from "./mermaidOps";

import type { DiagramsApi } from "../api";

export function createDiagramsApi(): DiagramsApi {
  return {
    async mermaidToElements(text) {
      if (typeof text !== "string" || text.trim() === "") {
        throw new Error("mermaidToElements needs the Mermaid text");
      }
      if (!getExtensions().mermaid) {
        throw new Error("Mermaid is turned off (Settings, Extensions)");
      }
      const lib = await import("@excalidraw/mermaid-to-excalidraw");
      const { elements } = await lib.parseMermaidToExcalidraw(text);
      return skeletonsToOps(elements as never);
    },
  };
}
