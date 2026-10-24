/**
 * Number with comma thousands separators, the same text as
 * `n.toLocaleString("en-US")` for safe integers (anything else falls back to it). Plain string work: the first
 * `toLocaleString` call loads ICU number data (about 2 ms, 8 ms on a slow laptop) on the
 * search results' first render, right when a vault opens.
 */
export const formatCount = (n: number): string => {
  const digits = String(Math.abs(n));
  if (!Number.isSafeInteger(n) || Object.is(n, -0)) {
    return n.toLocaleString("en-US");
  }
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
};
