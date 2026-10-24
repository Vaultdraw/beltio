import { definePlugin } from "@vaultdraw/api";
import { getCommands } from "@@ROOT@@/excalidraw-desktop/src/commands/registry";
import { newElement } from "@excalidraw/element";

export default definePlugin({ activate: () => [getCommands, newElement] });
