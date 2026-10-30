import { describe, expect, it } from "vitest";

import { validateCandidate } from "../theme/install/installer";

/**
 * Family sweep (toimprove 158, hunter D round 2 notes; family "error text built from internal
 * messages", siblings A-15 and BH-16): what "Look up" says about a bad theme file is read by the
 * user, so it must be plain words. No theme keys (mSurface), no format hints like "#rrggbb", no
 * quoted block names ("dark"), no JSON engine text. And a theme whose name is not a safe file
 * name is refused at Look up, not after the user pressed Install.
 *
 * Rows marked `fails` are confirmed bugs on main (validator, 2026-10-30): the fixer drops
 * `fails` per row when the message is plain; vitest then flags the rows that already agree.
 */
const KEYISH: RegExp[] = [
  /\bm[A-Z][A-Za-z]+\b/, // theme role keys: mSurface, mOnSurface, mPrimary
  /#rrggbb/i, // format placeholders
  /"(dark|light|name|author)"/, // quoted JSON keys
  /required:/,
  /Unexpected|SyntaxError|TypeError|undefined|\[object/,
];
const rawWords = (text: string) => KEYISH.filter((re) => re.test(text));

const messageOf = (json: string, fallback = "Linked theme") => {
  try {
    validateCandidate(json, fallback);
  } catch (err) {
    return (err as Error).message;
  }
  return null;
};

type Row = { name: string; json: string };

const BAD_FILES: Row[] = [
  { name: "not JSON at all", json: "<html>404</html>" },
  { name: "cut off", json: '{"name":"Cut","dark":{"mPrimary":"#fff' },
  { name: "an array", json: "[1,2,3]" },
  { name: "null", json: "null" },
  { name: "no colours", json: '{"name":"Hollow"}' },
  {
    name: "missing two required colours",
    json: '{"name":"Half","dark":{"mPrimary":"#123456"}}',
  },
  {
    name: "a colour that is not a colour",
    json: '{"name":"Evil","dark":{"mPrimary":"red;x","mSurface":"#101010","mOnSurface":"#eee"}}',
  },
  {
    name: "a number as the name",
    json: '{"name":42,"dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eee"}}',
  },
  {
    name: "an author that is not text",
    json: '{"name":"A","author":7,"dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eee"}}',
  },
];

describe("theme Look up explains a bad file in plain words", () => {
  for (const row of BAD_FILES) {
    it(row.name, () => {
      const message = messageOf(row.json);
      expect(message, "a bad file must be refused").not.toBeNull();
      expect(rawWords(message!), message!).toEqual([]);
    });
  }
});

const colours =
  '"dark":{"mPrimary":"#123456","mSurface":"#101010","mOnSurface":"#eee"}';
const UNSAFE_NAMES: Row[] = [
  { name: "../x", json: `{"name":"../x",${colours}}` },
  { name: "a/b", json: `{"name":"a/b",${colours}}` },
  { name: "..", json: `{"name":"..",${colours}}` },
  {
    name: "back\\slash",
    json: `{"name":"back\\\\slash",${colours}}`,
  },
];

describe("theme Look up refuses a name that is not a safe file name", () => {
  for (const row of UNSAFE_NAMES) {
    it(`refuses ${row.name}`, () => {
      expect(messageOf(row.json)).not.toBeNull();
    });
  }

  it("a plain name passes", () => {
    expect(messageOf(`{"name":"Midnight Blue",${colours}}`)).toBeNull();
  });
});
