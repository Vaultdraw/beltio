import { HELP_COMMAND_IDS as I } from "./helpCommands";

/** Link buttons of the About page and the welcome footer, in order. */
export const ABOUT_LINKS: readonly { command: string; label: string }[] = [
  { command: I.website, label: "Website" },
  { command: I.docs, label: "Documentation" },
  { command: I.keyboard, label: "Keyboard shortcuts" },
  { command: I.whatsNew, label: "What's new" },
  { command: I.checkUpdates, label: "Check for updates" },
  { command: I.reportBug, label: "Report a bug" },
  { command: I.requestFeature, label: "Request a feature" },
  { command: I.source, label: "Source code" },
  { command: I.license, label: "License and credits" },
];

/** The quiet row on the welcome screen. */
export const WELCOME_LINKS = [
  { command: I.website, label: "Website" },
  { command: I.docs, label: "Docs" },
  { command: I.reportBug, label: "Report a bug" },
] as const;
