import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { SettingsModal } from "../components/settings/SettingsModal";
import { getCommand } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";

import { toastStore } from "../toasts/toastStore";

import { AiHost } from "./AiHost";
import { cancelAiOn, isAiWarningPending } from "./aiSwitch";

import type { VaultInfo } from "../vault/types";

const vault: VaultInfo = {
  handle: "ai-switch-test",
  name: "Vault",
  path: "/Users/test/Vault",
  readOnly: false,
};

const prefs = () => getPreferences(window);
const run = (id: string) => act(() => void getRegisteredHandler(id)?.());

describe("AI preferences: config -> prefs -> config", () => {
  it("defaults: AI off, MCP on, edit notices on", () => {
    expect(DEFAULT_PREFERENCES.aiEnabled).toBe(false);
    expect(DEFAULT_PREFERENCES.aiMcpEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.controlNotifyEdits).toBe(true);
    const { values, problems } = configToPreferences({});
    expect(values.aiEnabled).toBe(false);
    expect(values.aiMcpEnabled).toBe(true);
    expect(values.controlNotifyEdits).toBe(true);
    expect(problems.filter((p) => p.key?.startsWith("ai."))).toEqual([]);
  });

  it("reads true and false", () => {
    const { values, problems } = configToPreferences({
      ai: { enabled: true, mcp_enabled: false },
      control: { notify_edits: false },
    });
    expect(problems).toEqual([]);
    expect(values.aiEnabled).toBe(true);
    expect(values.aiMcpEnabled).toBe(false);
    expect(values.controlNotifyEdits).toBe(false);
  });

  it("anything but literal true leaves AI off", () => {
    for (const bad of ["yes", "true", 1, null]) {
      const { values, problems } = configToPreferences({
        ai: { enabled: bad },
      });
      expect(values.aiEnabled).toBe(false);
      expect(problems.map((p) => p.key)).toEqual(["ai.enabled"]);
    }
    expect(normalizePreferences({ aiEnabled: "yes" }).aiEnabled).toBe(false);
    expect(normalizePreferences({ aiEnabled: 1 }).aiEnabled).toBe(false);
    expect(normalizePreferences({ aiEnabled: true }).aiEnabled).toBe(true);
  });

  it("a non-boolean MCP switch is off, like the app's check", () => {
    const { values, problems } = configToPreferences({
      ai: { mcp_enabled: "no" },
    });
    expect(values.aiMcpEnabled).toBe(false);
    expect(problems.map((p) => p.key)).toEqual(["ai.mcp_enabled"]);
    expect(problems[0].message).toContain("using false");
  });

  it("writes changed values under [ai] and [control]", () => {
    const changes = preferencesToConfigChanges(DEFAULT_PREFERENCES, {
      ...DEFAULT_PREFERENCES,
      aiEnabled: true,
      aiMcpEnabled: false,
      controlNotifyEdits: false,
    });
    const byKey = Object.fromEntries(changes.map((c) => [c.key, c.value]));
    expect(byKey["ai.enabled"]).toBe(true);
    expect(byKey["ai.mcp_enabled"]).toBe(false);
    expect(byKey["control.notify_edits"]).toBe(false);
  });
});

describe("AI commands", () => {
  it("are registered, unbound and need an open vault", () => {
    for (const [id, title] of [
      ["ai.toggle", "External AI tools: Toggle AI access"],
      [
        "ai.toggleMcp",
        "External AI tools: Toggle the AI tools interface (MCP)",
      ],
      ["ai.copyMcpSetup", "AI: Copy the AI app setup (MCP server config)"],
    ]) {
      const command = getCommand(id)!;
      expect(command.title).toBe(title);
      expect(command.category).toBe("AI");
      expect(command.keys.default).toEqual([]);
      expect(command.when).toEqual(["vaultOpen", "!modalOpen"]);
    }
  });
});

describe("AI switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ aiEnabled: false, aiMcpEnabled: true }, window);
  });
  afterEach(() => {
    cancelAiOn();
    cleanup();
    updatePreferences({ aiEnabled: false, aiMcpEnabled: true }, window);
    window.localStorage.clear();
  });

  it("ai.toggle asks first; only Turn on enables; Cancel leaves it off", () => {
    render(<AiHost win={window} />);
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    run("ai.toggle");
    const dialog = screen.getByTestId("ai-warning");
    expect(within(dialog).getByText("Turn on AI?")).toBeInTheDocument();
    expect(prefs().aiEnabled).toBe(false);
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    expect(prefs().aiEnabled).toBe(false);

    run("ai.toggle");
    fireEvent.click(screen.getByTestId("ai-warning-confirm"));
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    expect(prefs().aiEnabled).toBe(true);
  });

  it("Escape leaves it off", () => {
    render(<AiHost win={window} />);
    run("ai.toggle");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    expect(prefs().aiEnabled).toBe(false);
    expect(isAiWarningPending()).toBe(false);
  });

  it("ai.toggle turns AI off at once, without a dialog", () => {
    updatePreferences({ aiEnabled: true }, window);
    render(<AiHost win={window} />);
    run("ai.toggle");
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    expect(prefs().aiEnabled).toBe(false);
  });

  it("ai.toggleMcp flips ai.mcp_enabled", () => {
    render(<AiHost win={window} />);
    run("ai.toggleMcp");
    expect(prefs().aiMcpEnabled).toBe(false);
    run("ai.toggleMcp");
    expect(prefs().aiMcpEnabled).toBe(true);
    // AI is off here, so the notice says when it applies.
    expect(toastStore.getSnapshot().toasts.at(-1)?.message).toBe(
      "AI tools interface (MCP) turned on. It applies once AI is on",
    );
  });

  it("ai.copyMcpSetup copies the server entry and says what is still needed", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<AiHost win={window} />);
    run("ai.copyMcpSetup");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied).toEqual({
      mcpServers: { vaultdraw: { command: "vaultdraw", args: ["mcp"] } },
    });
    await vi.waitFor(() =>
      expect(toastStore.getSnapshot().toasts.at(-1)?.message).toContain(
        "Turn on AI in Settings",
      ),
    );
    // Copying changes no setting.
    expect(prefs().aiEnabled).toBe(false);
  });

  it("an unanswered warning does not come back after the host unmounts", () => {
    const { unmount } = render(<AiHost win={window} />);
    run("ai.toggle");
    expect(isAiWarningPending()).toBe(true);
    unmount();
    expect(isAiWarningPending()).toBe(false);
  });
});

describe("AI switch: Settings, Control page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updatePreferences({ aiEnabled: false, aiMcpEnabled: true }, window);
  });
  afterEach(() => {
    cancelAiOn();
    cleanup();
    updatePreferences({ aiEnabled: false, aiMcpEnabled: true }, window);
    window.localStorage.clear();
  });

  const renderControl = () =>
    render(
      <>
        <SettingsModal
          vault={vault}
          onClose={() => {}}
          ownerDocument={document}
          initialPage="control"
        />
        <AiHost win={window} />
      </>,
    );

  it("the MCP sub-switch shows only while AI is on", () => {
    renderControl();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByTestId("setting-ai-enabled")).toBeInTheDocument();
    expect(within(panel).getByText("Edit notices")).toBeInTheDocument();
    expect(within(panel).queryByTestId("setting-ai-mcp-enabled")).toBeNull();

    // On -> warning -> confirm -> sub-switch appears.
    fireEvent.click(
      within(within(panel).getByTestId("setting-ai-enabled")).getByRole(
        "switch",
      ),
    );
    expect(prefs().aiEnabled).toBe(false);
    fireEvent.click(screen.getByTestId("ai-warning-confirm"));
    expect(prefs().aiEnabled).toBe(true);
    expect(
      within(panel).getByTestId("setting-ai-mcp-enabled"),
    ).toBeInTheDocument();

    // Off needs no dialog and hides the sub-switch again.
    fireEvent.click(
      within(within(panel).getByTestId("setting-ai-enabled")).getByRole(
        "switch",
      ),
    );
    expect(screen.queryByTestId("ai-warning")).toBeNull();
    expect(prefs().aiEnabled).toBe(false);
    expect(within(panel).queryByTestId("setting-ai-mcp-enabled")).toBeNull();
  });

  it("the sub-switch and the notice switch write their keys", () => {
    updatePreferences({ aiEnabled: true }, window);
    renderControl();
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(
      within(within(panel).getByTestId("setting-ai-mcp-enabled")).getByRole(
        "switch",
      ),
    );
    expect(prefs().aiMcpEnabled).toBe(false);
    fireEvent.click(
      within(
        within(panel).getByText("Edit notices").closest(".vault-setting-row")!
          .parentElement ?? panel,
      ).getAllByRole("switch")[2],
    );
    expect(prefs().controlNotifyEdits).toBe(false);
  });
});
