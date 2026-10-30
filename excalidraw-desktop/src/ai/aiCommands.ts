/** Palette commands of the AI switch (category "AI"); handlers: AiHost. */
import type { CommandDefinition } from "../commands/types";

export const AI_COMMAND_IDS = {
  toggle: "ai.toggle",
  toggleMcp: "ai.toggleMcp",
  copyMcpSetup: "ai.copyMcpSetup",
} as const;

export const AI_COMMANDS: CommandDefinition[] = [
  {
    id: AI_COMMAND_IDS.toggle,
    title: "External AI tools: Toggle AI access",
    category: "AI",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: AI_COMMAND_IDS.toggleMcp,
    title: "External AI tools: Toggle the AI tools interface (MCP)",
    category: "AI",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
  {
    id: AI_COMMAND_IDS.copyMcpSetup,
    title: "External AI tools: Copy the AI app setup (MCP server config)",
    category: "AI",
    keys: { default: [] },
    when: ["vaultOpen", "!modalOpen"],
  },
];
