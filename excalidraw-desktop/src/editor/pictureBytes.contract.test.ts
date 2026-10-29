/**
 * One case table for "what picture do these bytes hold", read here and by Rust
 * `network::looks_like_image` (testing.md: twins share one case table). Hunter B,
 * 2026-10-30: an SVG with a long comment before `<svg` was refused, and a web page
 * with an inline `<svg>` icon was taken for a picture.
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/picture_bytes.json";
import { pictureType } from "../../../sdk/api/shared/sceneRules";

import { pictureType as pastedPictureType } from "./pasteWebImage";

type Case = { name: string; text?: string; hex?: string; type: string | null };

const bytesOf = (c: Case) =>
  c.hex !== undefined
    ? new Uint8Array(c.hex.match(/../g)!.map((h) => parseInt(h, 16)))
    : new TextEncoder().encode(c.text ?? "");

describe("picture bytes contract (paste, import and the plugin API share sceneRules.pictureType)", () => {
  it.each((table.cases as Case[]).map((c) => [c.name, c] as const))(
    "%s",
    (_name, c) => {
      const b = bytesOf(c);
      expect(pictureType(b)).toBe(c.type);
      expect(pastedPictureType(b)).toBe(c.type);
    },
  );
});
