/**
 * The whole first-run flow: one list. Add, remove or reorder a screen by
 * editing this list only; each screen is a small component in steps/.
 */
import { Basics } from "./steps/Basics";
import { Done } from "./steps/Done";
import { Extras } from "./steps/Extras";
import { Look } from "./steps/Look";
import { Network } from "./steps/Network";
import { Vault } from "./steps/Vault";
import { Welcome } from "./steps/Welcome";

import type { SetupStep } from "./types";

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "welcome",
    hero: true,
    title: () => "Your Excalidraw drawings, in a folder you own",
    nextLabel: () => "Get started",
    Component: Welcome,
  },
  {
    id: "look",
    title: () => "How should it look?",
    subtitle: () =>
      "Pick a mode and a theme. The window changes as you choose.",
    Component: Look,
  },
  {
    id: "basics",
    title: () => "A few basics",
    subtitle: () => "How you want to write and save.",
    Component: Basics,
  },
  {
    id: "network",
    title: () => "Use the internet?",
    subtitle: () => "On by default. One switch turns every online feature off.",
    Component: Network,
  },
  {
    id: "extras",
    title: () => "Which extras do you want?",
    subtitle: () => "Each is optional and costs nothing while it is off.",
    Component: Extras,
  },
  {
    id: "vault",
    title: (env) =>
      env.hasVault ? "Which vault?" : "Where are your drawings?",
    subtitle: () =>
      "A vault is a folder. Nothing in it is changed until you act.",
    Component: Vault,
  },
  {
    id: "done",
    title: () => "You are set",
    nextLabel: (env) =>
      env.vaultChoice.kind === "none"
        ? "Choose a vault"
        : env.vaultChoice.kind === "keep"
        ? "Finish"
        : "Open my vault",
    Component: Done,
  },
];
