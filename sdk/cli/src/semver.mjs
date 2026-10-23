/** Semantic versions as the Rust `semver` crate reads them (no leading `v`, no leading zeros). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** @param {string} v */
export const isSemver = (v) => SEMVER.test(v);

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive; both must be valid
 */
export function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) {
    throw new Error(`not a semantic version: ${pa ? b : a}`);
  }
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) {
      return d;
    }
  }
  if (pa[4] === pb[4]) {
    return 0;
  }
  if (pa[4] === undefined) {
    return 1;
  }
  if (pb[4] === undefined) {
    return -1;
  }
  const xa = pa[4].split(".");
  const xb = pb[4].split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) {
      return -1;
    }
    if (xb[i] === undefined) {
      return 1;
    }
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d !== 0) {
        return d;
      }
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return 0;
}
