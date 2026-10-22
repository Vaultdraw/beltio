import { APP_VERSION } from "../../../appVersion";
import { ABOUT_LINKS } from "../../../help/aboutLinks";
import { getAppCommandRunner } from "../../../commands/appRunner";

import "./about.css";

import type { SettingControls } from "../SettingsContext";

const AboutPage = () => (
  <div className="vault-about" data-testid="about-page">
    <div className="vault-about__mark" aria-hidden="true" />
    <h3 className="vault-about__name" aria-label="Vaultdraw">
      vault<span className="vault-about__accent">draw</span>
    </h3>
    <p className="vault-about__version" data-testid="about-version">
      Version {APP_VERSION}
    </p>
    <p className="vault-about__desc">
      An offline vault for your drawings: plain files on your disk, fast and
      keyboard-driven.
    </p>
    <div className="vault-about__links">
      {ABOUT_LINKS.map(({ command, label }) => (
        <button
          key={command}
          type="button"
          className="vault-btn vault-about__link"
          onClick={() => getAppCommandRunner()?.(command)}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);

export const aboutControls: SettingControls = {
  "about-info": { Component: AboutPage },
};
