/**
 * `ctx.markdown`: the gateway row `markdown.parse` (Rust parser, no
 * permission). Arguments are checked here first, as Rust checks them.
 */
import { markdownParams } from "../../../../sdk/api/shared/markdown";
import { utf8Length } from "../../../../sdk/api/shared/rules";

import { createGateway } from "./gateway";

import type { MarkdownApi, NoteDoc } from "../api";

export function createMarkdownApi(pluginId: string): MarkdownApi {
  const call = createGateway(pluginId);
  return {
    async parse(text, options) {
      const params = markdownParams(text, options);
      return call<NoteDoc>("markdown.parse", params, utf8Length(params.text));
    },
  };
}
