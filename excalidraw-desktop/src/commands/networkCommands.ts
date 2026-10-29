/** Network commands. The handler is bound by the app shell (network/useNetworkMode.ts). */
import type { CommandDefinition } from "./types";

export const NETWORK_COMMAND_IDS = {
  toggleOffline: "network.toggleOffline",
} as const;

export const NETWORK_COMMANDS: CommandDefinition[] = [
  {
    id: NETWORK_COMMAND_IDS.toggleOffline,
    title: "Offline mode: on or off",
    category: "Network",
    keys: { default: [] },
  },
];
