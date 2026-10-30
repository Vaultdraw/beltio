/**
 * The search index's fold. The one copy lives in `sdk/api/shared/fold.ts` so plugins get the same
 * fold as `ctx.text.fold` (toimprove: the graph plugin's own accent fold).
 */
export { CONTINUES, foldKey } from "../../../sdk/api/shared/fold";
