/**
 * Pure-ASCII form of JSON text (non-ASCII chars as `\uXXXX` escapes, the same
 * JSON value). JavaScriptCore stores a string in 1 byte per char only when all
 * its chars are Latin-1: one em dash or emoji makes a whole serialized drawing
 * 2 bytes per char, and `JSON.parse` of such text makes every string it
 * returns 2 bytes per char too, including image dataURLs (a 25 MB drawing with
 * one em dash measured +50 MB in WebKit). The native side sends drawings in this
 * form and turns the escapes back into raw UTF-8 when writing, so files on
 * disk are unchanged (src-tauri/src/json_ascii.rs; both use lowercase hex,
 * one escape per UTF-16 code unit, so equal scenes give equal text).
 */

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;
const NON_ASCII_UNITS = /[\u0080-\uffff]/g;

const escapeUnit = (unit: string) =>
  `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`;

export const toAsciiJson = (text: string): string => {
  if (!NON_ASCII.test(text)) {
    return text;
  }
  const escaped = text.replace(NON_ASCII_UNITS, escapeUnit);
  // `replace` keeps the 2-byte storage of its source; a JSON string round
  // trip of the now-ASCII text yields a 1-byte string (a few ms per MB).
  return JSON.parse(JSON.stringify(escaped)) as string;
};
