/**
 * Help commands: one per link (palette, Help menu, rebindable) plus
 * help.about. The link commands need no vault, so they work on the welcome
 * screen too; help.about opens Settings, which needs the shell.
 */
import { LINKS } from "./links";
import { openBugReport, openFeatureRequest, openWebLink } from "./openExternal";

import type { CommandDefinition, CommandHandlers } from "../commands/types";

export const HELP_COMMAND_IDS = {
  website: "help.website",
  docs: "help.docs",
  keyboard: "help.keyboard",
  reportBug: "help.reportBug",
  requestFeature: "help.requestFeature",
  whatsNew: "help.whatsNew",
  checkUpdates: "help.checkUpdates",
  source: "help.source",
  license: "help.license",
  about: "help.about",
} as const;

const I = HELP_COMMAND_IDS;

/** One label per help command: the palette title, the About page and the welcome screen read it. */
export const HELP_LABELS: Record<string, string> = {
  [I.website]: "Website",
  [I.docs]: "Documentation",
  [I.keyboard]: "Keyboard shortcuts",
  [I.reportBug]: "Report a bug",
  [I.requestFeature]: "Request a feature",
  [I.whatsNew]: "What's new",
  [I.checkUpdates]: "Check for updates",
  [I.source]: "Source code",
  [I.license]: "License and credits",
  [I.about]: "About Vaultdraw",
};

const command = (
  id: string,
  when: CommandDefinition["when"] = [],
): CommandDefinition => ({
  id,
  title: `Help: ${HELP_LABELS[id]}`,
  category: "Help",
  keys: { default: [] },
  when,
});

export const HELP_COMMANDS: CommandDefinition[] = [
  command(I.website),
  command(I.docs),
  command(I.keyboard),
  command(I.reportBug),
  command(I.requestFeature),
  command(I.whatsNew),
  command(I.checkUpdates),
  command(I.source),
  command(I.license),
  command(I.about, ["vaultOpen", "!modalOpen"]),
];

const open = (url: string) => () => {
  void openWebLink(url);
};

/** help.about is bound by the shell (it opens Settings). */
export const HELP_LINK_HANDLERS: CommandHandlers = {
  [I.website]: open(LINKS.website),
  [I.docs]: open(LINKS.docs),
  [I.keyboard]: open(LINKS.keyboard),
  [I.reportBug]: () =>
    void openWebLink("", { open: openBugReport, label: "the bug report page" }),
  [I.requestFeature]: () =>
    void openWebLink("", {
      open: openFeatureRequest,
      label: "the feature request page",
    }),
  [I.whatsNew]: open(LINKS.whatsNew),
  [I.checkUpdates]: open(LINKS.checkUpdates),
  [I.source]: open(LINKS.source),
  [I.license]: open(LINKS.license),
};
