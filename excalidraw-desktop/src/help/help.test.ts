import { describe, expect, it } from "vitest";

import { getCommand } from "../commands/commands";

import { ABOUT_LINKS, WELCOME_LINKS } from "./aboutLinks";
import {
  HELP_COMMAND_IDS,
  HELP_COMMANDS,
  HELP_LINK_HANDLERS,
} from "./helpCommands";
import { bugReportUrl, featureRequestUrl, LINKS, SITE } from "./links";

describe("links", () => {
  it("derive from the one site constant and are https", () => {
    expect(LINKS.website).toBe(SITE);
    expect(LINKS.docs).toBe(`${SITE}/docs/`);
    expect(LINKS.keyboard).toBe(`${SITE}/docs/keyboard/`);
    for (const url of Object.values(LINKS)) {
      expect(url.startsWith("https://")).toBe(true);
    }
    expect(LINKS.newIssue).toBe(
      "https://github.com/Vaultdraw/vaultdraw/issues/new",
    );
  });
});

describe("bug report url", () => {
  const url = new URL(
    bugReportUrl({
      version: "0.1.2",
      os: "macos",
      osVersion: "15.1",
      arch: "aarch64",
    }),
  );
  const body = url.searchParams.get("body") ?? "";

  it("targets new issues with an encoded title and body", () => {
    expect(url.origin + url.pathname).toBe(LINKS.newIssue);
    expect(url.searchParams.get("title")).toBe("Bug: ");
    expect(url.href).not.toMatch(/\s/);
    expect(url.href).toContain("%0A");
  });

  it("has the template plus version and system", () => {
    expect(body).toContain("What happened");
    expect(body).toContain("Steps to reproduce");
    expect(body).toContain("Expected");
    expect(body).toContain("Vaultdraw 0.1.2, macOS 15.1 (aarch64)");
  });

  it("works without system facts and carries nothing personal", () => {
    const bare = new URL(bugReportUrl({ version: "0.1.2" })).searchParams.get(
      "body",
    );
    expect(bare).toContain("Vaultdraw 0.1.2\n");
    expect(bare).not.toContain("/Users/");
  });

  it("feature request has a template", () => {
    const f = new URL(featureRequestUrl());
    expect(f.searchParams.get("title")).toBe("Feature: ");
    expect(f.searchParams.get("body")).toContain("What would you like?");
  });
});

describe("help commands", () => {
  it("are registered with titles in the Help category", () => {
    for (const id of Object.values(HELP_COMMAND_IDS)) {
      const command = getCommand(id);
      expect(command, id).toBeDefined();
      expect(command?.title).toMatch(/^Help: .+/);
      expect(command?.category).toBe("Help");
    }
    expect(HELP_COMMANDS).toHaveLength(10);
  });

  it("every link command has a handler; about is bound by the shell", () => {
    for (const id of Object.values(HELP_COMMAND_IDS)) {
      expect(Boolean(HELP_LINK_HANDLERS[id])).toBe(
        id !== HELP_COMMAND_IDS.about,
      );
    }
  });

  it("About and welcome links point at registered commands", () => {
    for (const { command } of [...ABOUT_LINKS, ...WELCOME_LINKS]) {
      expect(getCommand(command), command).toBeDefined();
    }
  });
});
