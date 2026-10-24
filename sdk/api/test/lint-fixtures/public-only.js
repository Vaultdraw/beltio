import { createElement as h } from "react";
import { definePlugin } from "@vaultdraw/api";
import { format } from "./format";

export default definePlugin({ activate: () => [h, format] });
