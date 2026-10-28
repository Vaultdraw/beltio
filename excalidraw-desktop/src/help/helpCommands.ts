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

const command = (
  id: string,
  title: string,
  when: CommandDefinition["when"] = [],
): CommandDefinition => ({
  id,
  title: `Help: ${title}`,
  category: "Help",
  keys: { default: [] },
  when,
});

export const HELP_COMMANDS: CommandDefinition[] = [
  command(I.website, "Website"),
  command(I.docs, "Documentation"),
  command(I.keyboard, "Keyboard shortcuts"),
  command(I.reportBug, "Report a bug"),
  command(I.requestFeature, "Request a feature"),
  command(I.whatsNew, "What's new"),
  command(I.checkUpdates, "Check for updates"),
  command(I.source, "Source code"),
  command(I.license, "License and credits"),
  command(I.about, "About Vaultdraw", ["vaultOpen", "!modalOpen"]),
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
