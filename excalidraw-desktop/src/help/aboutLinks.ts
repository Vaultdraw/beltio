import { HELP_COMMAND_IDS as I, HELP_LABELS } from "./helpCommands";

const link = (command: string, label = HELP_LABELS[command]) => ({
  command,
  label,
});

/** The About page's primary button. */
export const ABOUT_PRIMARY = link(I.checkUpdates);

/** The About page's quiet text links, in order. */
export const ABOUT_LINKS: readonly { command: string; label: string }[] = [
  link(I.website),
  link(I.docs),
  link(I.keyboard),
  link(I.whatsNew),
  link(I.reportBug),
  link(I.requestFeature),
  link(I.source),
  link(I.license),
];

/** The quiet row on the welcome screen. */
export const WELCOME_LINKS = [
  link(I.website),
  link(I.docs, "Docs"),
  link(I.reportBug),
] as const;
