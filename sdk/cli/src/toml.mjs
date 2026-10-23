/**
 * A small TOML reader for `plugin.toml`. Rust (`manifest.rs`) stays the authority;
 * this reads what manifests use: strings (basic, literal, multi-line), integers,
 * floats, booleans, arrays, inline tables, tables, arrays of tables and dotted
 * keys. Dates and anything else throw a located `TomlError`.
 */

export class TomlError extends Error {
  /**
   * @param {string} message
   * @param {number} line 1-based
   */
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = "TomlError";
    this.line = line;
  }
}

const BARE = /[A-Za-z0-9_-]/;
const ESCAPES = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/**
 * @param {string} text
 * @returns {Record<string, any>} a plain object; arrays of tables are arrays of objects
 */
export function parseToml(text) {
  let pos = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root = Object.create(null);
  /** Tables created by `[a.b]` headers or inline tables: they may not be reopened. */
  const defined = new WeakSet();
  /** Tables only implied by a dotted header or key: a later header may define them once. */
  const implicit = new WeakSet();
  let current = root;

  const line = () => {
    let n = 1;
    for (let i = 0; i < pos && i < src.length; i++) {
      if (src.charCodeAt(i) === 10) {
        n++;
      }
    }
    return n;
  };
  /** @param {string} m @returns {never} */
  const fail = (m) => {
    throw new TomlError(m, line());
  };
  const peek = () => src[pos];
  const skipSpace = () => {
    while (src[pos] === " " || src[pos] === "\t") {
      pos++;
    }
  };
  const skipComment = () => {
    if (src[pos] === "#") {
      while (pos < src.length && src[pos] !== "\n") {
        pos++;
      }
    }
  };
  const skipBlank = () => {
    for (;;) {
      skipSpace();
      skipComment();
      if (src[pos] === "\r" && src[pos + 1] === "\n") {
        pos++;
      }
      if (src[pos] === "\n") {
        pos++;
      } else {
        return;
      }
    }
  };
  const endOfLine = () => {
    skipSpace();
    skipComment();
    if (pos >= src.length) {
      return;
    }
    if (src[pos] === "\r" && src[pos + 1] === "\n") {
      pos++;
    }
    if (src[pos] !== "\n") {
      fail(`unexpected text '${src.slice(pos, pos + 12).split("\n")[0]}'`);
    }
    pos++;
  };

  const readBasicString = () => {
    const multi = src.startsWith('"""', pos);
    pos += multi ? 3 : 1;
    if (multi) {
      if (src[pos] === "\r" && src[pos + 1] === "\n") {
        pos++;
      }
      if (src[pos] === "\n") {
        pos++;
      }
    }
    let out = "";
    for (;;) {
      if (pos >= src.length) {
        fail("unterminated string");
      }
      const c = src[pos];
      if (multi ? src.startsWith('"""', pos) : c === '"') {
        pos += multi ? 3 : 1;
        return out;
      }
      if (c === "\n" && !multi) {
        fail("unterminated string");
      }
      if (c === "\\") {
        const n = src[pos + 1];
        if (n in ESCAPES) {
          out += ESCAPES[n];
          pos += 2;
        } else if (n === "u" || n === "U") {
          const len = n === "u" ? 4 : 8;
          const hex = src.slice(pos + 2, pos + 2 + len);
          const cp = Number.parseInt(hex, 16);
          if (
            !/^[0-9a-fA-F]+$/.test(hex) ||
            hex.length !== len ||
            cp > 0x10ffff ||
            (cp >= 0xd800 && cp <= 0xdfff)
          ) {
            fail("invalid unicode escape");
          }
          out += String.fromCodePoint(cp);
          pos += 2 + len;
        } else if (multi && /[ \t\r\n]/.test(n ?? "")) {
          pos++;
          while (/[ \t\r\n]/.test(src[pos] ?? "x")) {
            pos++;
          }
        } else {
          fail(`invalid escape '\\${n ?? ""}'`);
        }
      } else {
        out += c;
        pos++;
      }
    }
  };

  const readLiteralString = () => {
    const multi = src.startsWith("'''", pos);
    const q = multi ? "'''" : "'";
    pos += q.length;
    if (multi) {
      if (src[pos] === "\r" && src[pos + 1] === "\n") {
        pos++;
      }
      if (src[pos] === "\n") {
        pos++;
      }
    }
    const end = src.indexOf(q, pos);
    if (end < 0) {
      fail("unterminated string");
    }
    const out = src.slice(pos, end);
    if (!multi && out.includes("\n")) {
      fail("unterminated string");
    }
    pos = end + q.length;
    return out;
  };

  const readKey = () => {
    skipSpace();
    const c = peek();
    if (c === '"') {
      return readBasicString();
    }
    if (c === "'") {
      return readLiteralString();
    }
    const start = pos;
    while (pos < src.length && BARE.test(src[pos])) {
      pos++;
    }
    if (start === pos) {
      fail(c === undefined ? "expected a key" : `expected a key, found '${c}'`);
    }
    return src.slice(start, pos);
  };

  const readKeyPath = () => {
    const keys = [readKey()];
    for (;;) {
      skipSpace();
      if (src[pos] !== ".") {
        return keys;
      }
      pos++;
      keys.push(readKey());
    }
  };

  /** @returns {any} */
  const readValue = () => {
    skipSpace();
    const c = peek();
    if (c === '"') {
      return readBasicString();
    }
    if (c === "'") {
      return readLiteralString();
    }
    if (c === "[") {
      return readArray();
    }
    if (c === "{") {
      return readInlineTable();
    }
    const m = /^[^\s,\]}#]+/.exec(src.slice(pos, pos + 200));
    if (!m) {
      fail(
        c === undefined ? "expected a value" : `expected a value, found '${c}'`,
      );
    }
    const tok = m[0];
    if (tok === "true" || tok === "false") {
      pos += tok.length;
      return tok === "true";
    }
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(tok)) {
      pos += tok.length;
      const n = Number(tok.replaceAll("_", ""));
      if (!Number.isSafeInteger(n)) {
        fail(`integer ${tok} is too large`);
      }
      return n;
    }
    if (
      /^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(tok)
    ) {
      pos += tok.length;
      return Number(tok.replaceAll("_", ""));
    }
    if (/^0[xob]/.test(tok)) {
      pos += tok.length;
      return Number(tok.replaceAll("_", ""));
    }
    if (/^\d{4}-\d\d-\d\d/.test(tok) || /^\d\d:\d\d/.test(tok)) {
      fail("dates and times are not supported in plugin.toml");
    }
    fail(`invalid value '${tok}'`);
  };

  const readArray = () => {
    pos++;
    const items = [];
    for (;;) {
      skipBlank();
      if (src[pos] === "]") {
        pos++;
        return items;
      }
      if (pos >= src.length) {
        fail("unterminated array");
      }
      items.push(readValue());
      skipBlank();
      if (src[pos] === ",") {
        pos++;
      } else if (src[pos] !== "]") {
        fail(
          pos >= src.length
            ? "unterminated array"
            : "expected ',' or ']' in array",
        );
      }
    }
  };

  const readInlineTable = () => {
    pos++;
    const table = Object.create(null);
    defined.add(table);
    skipSpace();
    if (src[pos] === "}") {
      pos++;
      return table;
    }
    for (;;) {
      readPair(table);
      skipSpace();
      if (src[pos] === ",") {
        pos++;
        skipSpace();
      } else if (src[pos] === "}") {
        pos++;
        return table;
      } else {
        fail("expected ',' or '}' in inline table");
      }
    }
  };

  /** Walks `keys` below `base`, creating implicit tables; arrays of tables continue in their last item. */
  const descend = (base, keys) => {
    let t = base;
    for (const k of keys) {
      let next = t[k];
      if (next === undefined) {
        next = Object.create(null);
        implicit.add(next);
        t[k] = next;
      } else if (Array.isArray(next)) {
        next = next[next.length - 1];
        if (typeof next !== "object" || next === null || Array.isArray(next)) {
          fail(`'${k}' is not a table`);
        }
      } else if (typeof next !== "object" || next === null) {
        fail(`'${k}' is already a value, not a table`);
      }
      t = next;
    }
    return t;
  };

  const readPair = (table) => {
    const keys = readKeyPath();
    skipSpace();
    if (src[pos] !== "=") {
      fail(`expected '=' after key '${keys.join(".")}'`);
    }
    pos++;
    const parent = descend(table, keys.slice(0, -1));
    if (defined.has(parent) && parent !== table && !implicit.has(parent)) {
      fail(
        `cannot add to the already defined table '${keys
          .slice(0, -1)
          .join(".")}'`,
      );
    }
    const key = keys[keys.length - 1];
    if (key in parent) {
      fail(`duplicate key '${keys.join(".")}'`);
    }
    parent[key] = readValue();
  };

  while (pos < src.length) {
    skipBlank();
    if (pos >= src.length) {
      break;
    }
    if (src[pos] === "[") {
      const isArray = src[pos + 1] === "[";
      pos += isArray ? 2 : 1;
      const keys = readKeyPath();
      skipSpace();
      if (!src.startsWith(isArray ? "]]" : "]", pos)) {
        fail(`expected '${isArray ? "]]" : "]"}' to close the table header`);
      }
      pos += isArray ? 2 : 1;
      const parent = descend(root, keys.slice(0, -1));
      const last = keys[keys.length - 1];
      if (isArray) {
        const existing = parent[last];
        if (existing === undefined) {
          parent[last] = [];
        } else if (!Array.isArray(existing)) {
          fail(
            `'${keys.join(
              ".",
            )}' is already defined and is not an array of tables`,
          );
        }
        current = Object.create(null);
        defined.add(current);
        parent[last].push(current);
      } else {
        let t = parent[last];
        if (t === undefined) {
          t = Object.create(null);
          parent[last] = t;
        } else if (
          Array.isArray(t) ||
          typeof t !== "object" ||
          !implicit.has(t)
        ) {
          fail(`table '${keys.join(".")}' is defined twice`);
        } else {
          implicit.delete(t);
        }
        defined.add(t);
        current = t;
      }
      endOfLine();
    } else {
      readPair(current);
      endOfLine();
    }
  }
  return root;
}
