/**
 * A small code colouriser for the reading view: strings, comments, numbers
 * and keywords, by language family. It returns HTML made only of escaped text
 * and `<span class="tok-…">`, so it needs no sanitising of its own. Not a
 * parser: unknown languages come back plain (escaped).
 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Family {
  line: string[];
  block: [string, string] | null;
  keywords: Set<string>;
}

const words = (s: string) => new Set(s.split(/\s+/));

const C_LIKE = (kw: string): Family => ({
  line: ["//"],
  block: ["/*", "*/"],
  keywords: words(kw),
});
const HASH = (kw: string): Family => ({
  line: ["#"],
  block: null,
  keywords: words(kw),
});

const JS = C_LIKE(
  "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this super null undefined true false interface type enum implements public private protected readonly static void",
);
const FAMILIES: Record<string, Family> = {
  js: JS,
  ts: JS,
  jsx: JS,
  tsx: JS,
  json: { line: [], block: null, keywords: words("true false null") },
  rust: C_LIKE(
    "fn let mut const static struct enum impl trait pub use mod crate self Self match if else for while loop return break continue move async await where as in ref true false unsafe type dyn",
  ),
  go: C_LIKE(
    "func var const type struct interface package import return if else for range switch case default break continue go defer chan map select nil true false",
  ),
  c: C_LIKE(
    "int char long short float double void unsigned signed const static struct enum union typedef return if else for while do switch case break continue sizeof NULL true false class public private new delete namespace template using",
  ),
  java: C_LIKE(
    "class interface extends implements public private protected static final void int long double float boolean char new return if else for while do switch case break continue try catch finally throw throws import package null true false this super",
  ),
  css: { line: [], block: ["/*", "*/"], keywords: words("important") },
  py: HASH(
    "def class return if elif else for while in not and or is import from as with try except finally raise lambda yield pass break continue None True False self async await global nonlocal",
  ),
  sh: HASH(
    "if then else elif fi for while do done case esac function in return local export echo cd exit set unset",
  ),
  yaml: HASH("true false null yes no"),
  toml: HASH("true false"),
  ruby: HASH(
    "def class module end if elsif else unless while until for do begin rescue ensure return yield self nil true false require",
  ),
  sql: {
    line: ["--"],
    block: ["/*", "*/"],
    keywords: words(
      "select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as null is in distinct union",
    ),
  },
};

const ALIASES: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  mjs: "js",
  cjs: "js",
  rs: "rust",
  golang: "go",
  "c++": "c",
  cpp: "c",
  h: "c",
  cs: "java",
  kotlin: "java",
  python: "py",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  yml: "yaml",
  rb: "ruby",
  scss: "css",
  jsonc: "json",
};

const familyOf = (lang: string | undefined): Family | null => {
  if (!lang) {
    return null;
  }
  const key = lang.toLowerCase();
  return FAMILIES[ALIASES[key] ?? key] ?? null;
};

const span = (cls: string, text: string) =>
  `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

/** HTML for `code` coloured by `lang`; plain escaped text for an unknown language. */
export function highlightCode(code: string, lang: string | undefined): string {
  const family = familyOf(lang);
  if (!family || code.length > 200_000) {
    return escapeHtml(code);
  }
  let out = "";
  let i = 0;
  const n = code.length;
  const startsWith = (s: string) => s !== "" && code.startsWith(s, i);
  while (i < n) {
    const ch = code[i];
    const lineStart = family.line.find((l) => startsWith(l));
    if (lineStart) {
      let end = code.indexOf("\n", i);
      end = end < 0 ? n : end;
      out += span("comment", code.slice(i, end));
      i = end;
    } else if (family.block && startsWith(family.block[0])) {
      const close = code.indexOf(family.block[1], i + family.block[0].length);
      const end = close < 0 ? n : close + family.block[1].length;
      out += span("comment", code.slice(i, end));
      i = end;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && code[j] !== ch && (code[j] !== "\n" || ch === "`")) {
        j += code[j] === "\\" ? 2 : 1;
      }
      const end = Math.min(n, j + 1);
      out += span("string", code.slice(i, end));
      i = end;
    } else if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? "")) {
      const m = /^(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        code.slice(i, i + 40),
      );
      const len = m ? m[0].length : 1;
      out += span("number", code.slice(i, i + len));
      i += len;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j])) {
        j++;
      }
      const word = code.slice(i, j);
      out += family.keywords.has(word)
        ? span("keyword", word)
        : escapeHtml(word);
      i = j;
    } else {
      out += escapeHtml(ch);
      i++;
    }
  }
  return out;
}
