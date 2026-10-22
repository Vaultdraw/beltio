/** Every external link the app offers (palette, Help menu, About, welcome). */
export const SITE = "https://vaultdraw.vercel.app";

const REPO = "https://github.com/Vaultdraw/vaultdraw";

export const LINKS = {
  website: SITE,
  docs: `${SITE}/docs/`,
  keyboard: `${SITE}/docs/keyboard/`,
  whatsNew: `${REPO}/blob/main/CHANGELOG.md`,
  checkUpdates: `${REPO}/releases/latest`,
  newIssue: `${REPO}/issues/new`,
  source: REPO,
  license: `${REPO}/blob/main/LICENSE`,
} as const;

/** Facts a bug report carries; nothing personal (no paths, no vault names). */
export interface ReportEnv {
  version: string;
  os?: string;
  osVersion?: string;
  arch?: string;
}

const envLine = ({ version, os, osVersion, arch }: ReportEnv): string => {
  const system = [os === "macos" ? "macOS" : os, osVersion, arch && `(${arch})`]
    .filter(Boolean)
    .join(" ");
  return [`Vaultdraw ${version}`, system].filter(Boolean).join(", ");
};

const issueUrl = (title: string, body: string): string =>
  `${LINKS.newIssue}?title=${encodeURIComponent(
    title,
  )}&body=${encodeURIComponent(body)}`;

export const bugReportUrl = (env: ReportEnv): string =>
  issueUrl(
    "Bug: ",
    `**What happened**\n\n\n**Steps to reproduce**\n1. \n\n**Expected**\n\n\n**Environment**\n${envLine(
      env,
    )}\n`,
  );

export const featureRequestUrl = (): string =>
  issueUrl(
    "Feature: ",
    "**What would you like?**\n\n\n**Why (what are you trying to do)?**\n\n",
  );
