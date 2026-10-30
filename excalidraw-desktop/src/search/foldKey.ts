/**
 * The search index's fold in TypeScript: tag keys and link keys compare with the native keys
 * (`normalize` in src-tauri/crates/vaultdraw-core/src/search/normalize.rs), so what the user types
 * is folded the same way. One case table pins both (vaultdraw-core/src/contract/fold_cases.json,
 * run by src/tests/foldContract.test.ts and `fold_cases_contract_table` in Rust).
 * Whitespace is left as written (the index collapses runs; tag and link keys have none).
 */

const ASCII = /^\p{ASCII}*$/u;
// Marks that are stripped; never U+3099/U+309A (が stays distinct from か) nor Indic or Thai signs.
const STRIPPABLE = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/gu;
// A mark or conjoining Hangul jamo continues the cluster before it.
const CONTINUES = /[\p{M}ᅠ-ᇿힰ-퟿]/u;

const foldLowered = (s: string): string =>
  s
    .replace(STRIPPABLE, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ı/g, "i")
    // katakana letters and iteration marks to hiragana
    .replace(/[ァ-ヶヽヾ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );

const foldChar = (c: string): string => {
  const code = c.codePointAt(0) as number;
  if (code < 0x80) {
    return c.toLowerCase();
  }
  if (code >= 0xac00 && code <= 0xd7a3) {
    return c;
  }
  if (code >= 0x3040 && code <= 0x30ff) {
    return foldLowered(c.normalize("NFKC"));
  }
  return foldLowered(c.normalize("NFKD").toLowerCase());
};

/** The key the index would store for this text (one word, no whitespace collapsing). */
export const foldKey = (text: string): string => {
  if (ASCII.test(text)) {
    return text.toLowerCase();
  }
  const chars = Array.from(text);
  let out = "";
  for (let i = 0; i < chars.length; ) {
    let cluster = chars[i++];
    while (i < chars.length && CONTINUES.test(chars[i])) {
      cluster += chars[i++];
    }
    for (const c of cluster.normalize("NFC")) {
      out += foldChar(c);
    }
  }
  return out;
};
