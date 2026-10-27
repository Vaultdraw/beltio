// MathJax v3 TeX -> SVG (paths, no font cache). Runs inside the formula worker.
// Static imports of each TeX package so the bundler includes them. NOT AllPackages
// (it pulls in `require`/`html`, which we do not want in stored SVGs).
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

import { postProcessSvg } from "./svgPost";

import type { FormulaRender, FormulaRequest } from "./types";

const MAX_SOURCE_LENGTH = 20_000;

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");

export const createMathJaxEngine = (): {
  render(req: FormulaRequest): FormulaRender;
} => {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams", "newcommand", "boldsymbol"],
    }),
    OutputJax: new SVG({ fontCache: "none" }),
  });

  return {
    render(req) {
      try {
        if (!req.source.trim()) {
          return { ok: false, error: "Empty formula" };
        }
        if (req.source.length > MAX_SOURCE_LENGTH) {
          return { ok: false, error: "Formula is too long" };
        }
        const node = doc.convert(req.source, { display: req.display });
        const raw = adaptor.innerHTML(node);
        const err = raw.match(/data-mjx-error="([^"]*)"/);
        if (err) {
          return { ok: false, error: decodeXml(err[1]) };
        }
        return postProcessSvg(raw, req.color);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Could not render formula",
        };
      }
    },
  };
};
