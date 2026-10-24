/**
 * Pure, all-or-nothing validation of a batch of scene ops. One copy for the
 * app, the control API and the plugin mock host: sdk/api/testing/sceneRules.ts.
 */
export {
  dataKeyFor,
  dataKeyProblem,
  FONT_NAMES,
  MAX_COORD,
  MAX_DATA_BYTES,
  MAX_OPS,
  MAX_OPS_LIMIT,
  MAX_SIZE,
  MAX_TEXT,
  opsLimit,
  validateOps,
} from "../../../sdk/api/testing/sceneRules";
export type {
  OpTarget,
  ValidateOptions,
} from "../../../sdk/api/testing/sceneRules";
