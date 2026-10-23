import { describe, expect, it } from "vitest";

import { parseToml, TomlError } from "../src/toml.mjs";

const plain = (v) => JSON.parse(JSON.stringify(v));

describe("parseToml", () => {
  it("reads scalars, comments and arrays", () => {
    const doc = parseToml(`# top
id = "a-b" # trailing
n = 12
neg = -3
big = 1_000
f = 0.5
e = 1e3
yes = true
no = false
list = ["x", 'y', "z",]
multi = [
  1, # one
  2,
]
lit = 'C:\\path'
esc = "tab\\tquote\\"\\u00e9"
`);
    expect(plain(doc)).toEqual({
      id: "a-b",
      n: 12,
      neg: -3,
      big: 1000,
      f: 0.5,
      e: 1000,
      yes: true,
      no: false,
      list: ["x", "y", "z"],
      multi: [1, 2],
      lit: "C:\\path",
      esc: 'tab\tquote"\u00e9',
    });
  });

  it("reads arrays of tables, tables, inline tables and dotted keys", () => {
    const doc = parseToml(`
[[contributes.commands]]
id = "one"
[[contributes.commands]]
id = "two"
[[contributes.settings]]
key = "k"
options = [{ value = "a", label = "A" }, { value = "b", label = "B" }]
[x-build]
sdk = "abc"
[a.b]
c = 1
d.e = 2
`);
    expect(plain(doc)).toEqual({
      contributes: {
        commands: [{ id: "one" }, { id: "two" }],
        settings: [
          {
            key: "k",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      },
      "x-build": { sdk: "abc" },
      a: { b: { c: 1, d: { e: 2 } } },
    });
  });

  it("reads multi-line strings", () => {
    const doc = parseToml(
      "a = \"\"\"\nline one\nline two\"\"\"\nb = '''\nraw \\n'''\n",
    );
    expect(doc.a).toBe("line one\nline two");
    expect(doc.b).toBe("raw \\n");
  });

  it("accepts a byte order mark and CRLF line ends", () => {
    expect(plain(parseToml('\ufeffid = "a"\r\nname = "b"\r\n'))).toEqual({
      id: "a",
      name: "b",
    });
  });

  it.each([
    ['id = "oops', 1, "unterminated"],
    ["name = = x", 1, "invalid value"],
    ["a = 1\na = 2", 2, "duplicate key"],
    ["a = 1\n[a]", 2, "defined"],
    ["a = 2024-01-01", 1, "dates"],
    ["a = what", 1, "invalid value"],
    ["a = [1, 2", 1, "unterminated array"],
    ["a = { b = 1", 1, "inline table"],
    ["a = 1 b = 2", 1, "unexpected text"],
    ['a = "\\q"', 1, "escape"],
    ["[x\nb = 1", 1, "table header"],
    ["a b = 1", 1, "expected '='"],
  ])("throws a located error for %j", (text, line, fragment) => {
    let error;
    try {
      parseToml(text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TomlError);
    expect(error.line).toBe(line);
    expect(error.message).toContain(fragment);
    expect(error.message).toMatch(/^line \d+:/);
  });
});
