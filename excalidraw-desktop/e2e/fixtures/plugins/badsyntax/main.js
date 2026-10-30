// A module that cannot load (its import is missing), like a plugin with a broken build.
import "./missing-file.js";

export default {
  activate() {},
};
