import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { readCustomContextKey } from "../commands/contextKeys";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import {
  THEME_BROWSER_COMMAND_IDS,
  THEME_BROWSER_CONTEXT_KEY,
} from "../commands/themeCommands";
import { ThemeBrowserDialog } from "../components/ThemeBrowserDialog";
import { entryUrl } from "../theme/catalogue/client";
import { InstallError } from "../theme/install/types";
import { setThemeRegistry } from "../theme/registry";
import { getPreferences, updatePreferences } from "../vault/preferences";

import type { CatalogueBackend, RawIndex } from "../theme/catalogue/types";
import type { InstalledTheme, InstallBackend } from "../theme/install/types";

const SHA_V = "a".repeat(64);
const SHA_N = "b".repeat(64);
const SHA_NEW = "c".repeat(64);

let catalogue: CatalogueBackend;
let install: InstallBackend;
vi.mock("../theme/catalogue/backends", () => ({
  getCatalogueBackend: async () => catalogue,
}));
vi.mock("../theme/install/backends", () => ({
  getInstallBackend: async () => install,
}));

const theme = (over: Record<string, unknown> = {}) => ({
  name: "Vesper",
  path: "Vesper/Vesper.json",
  author: "Rauno",
  description: "Warm dark theme",
  tags: ["dark", "warm"],
  modes: ["dark"],
  swatch: { dark: ["#101010", "#ffffff", "#ffc799"] },
  sha256: SHA_V,
  previews: [],
  credit: "Rauno Freiberg",
  licence: "MIT",
  ...over,
});

const NORD = theme({
  name: "Nordic",
  path: "Nordic/Nordic.json",
  author: "Arctic",
  description: "Cool light palette",
  tags: ["light", "cool"],
  modes: ["light"],
  swatch: { light: ["#eeeeee", "#222222", "#5e81ac"] },
  sha256: SHA_N,
  credit: undefined,
  licence: "GPL",
});

const themeJson = (name: string) =>
  JSON.stringify({
    name,
    dark: { mSurface: "#101820", mOnSurface: "#e8e8e8", mPrimary: "#4aa3ff" },
  });

const raw = (themes: unknown[], fetchedAt?: number): RawIndex => ({
  json: JSON.stringify({ schemaVersion: 1, themes }),
  sha256: "i".repeat(64),
  fetched_at: fetchedAt ?? Math.floor(Date.now() / 1000),
  url: getPreferences().themesIndexUrl,
});

let installedList: InstalledTheme[];

const makeCatalogue = (over: Partial<CatalogueBackend> = {}) =>
  ({
    cached: vi.fn(async () => null),
    refresh: vi.fn(async () => raw([theme(), NORD])),
    preview: vi.fn(async () => new Uint8Array([0x89, 0x50, 1, 2])),
    ...over,
  } as CatalogueBackend);

const makeInstall = (over: Partial<InstallBackend> = {}): InstallBackend => ({
  resolve: vi.fn(),
  fetch: vi.fn(async (ref) => {
    const url = (ref as { url: string }).url;
    const isNord = url.includes("Nordic");
    return {
      json: themeJson(isNord ? "Nordic" : "Vesper"),
      sha256: isNord ? SHA_N : SHA_V,
      url,
    };
  }),
  write: vi.fn(async (r) => {
    installedList = [
      ...installedList.filter((t) => t.name !== r.name),
      { name: r.name, source: r.source },
    ];
    return { name: r.name };
  }),
  installed: vi.fn(async () => installedList),
  updateFetch: vi.fn(),
  uninstall: vi.fn(async (name) => {
    installedList = installedList.filter((t) => t.name !== name);
  }),
  ...over,
});

const prefs = (patch: Record<string, unknown>) =>
  act(() => {
    updatePreferences(patch);
  });

const names = () =>
  Array.from(document.querySelectorAll('li[role="option"]')).map(
    (el) => el.querySelector("strong")?.textContent,
  );

const openReady = async () => {
  render(<ThemeBrowserDialog onClose={vi.fn()} />);
  await screen.findByTestId("theme-card-Vesper");
};

const key = (k: string, extra: { shiftKey?: boolean } = {}) =>
  fireEvent.keyDown(screen.getByLabelText("Search themes"), {
    key: k,
    ...extra,
  });

beforeEach(() => {
  installedList = [];
  catalogue = makeCatalogue();
  install = makeInstall();
  prefs({
    networkEnabled: true,
    networkAllowThemes: true,
    themesPreviews: true,
  });
});
afterEach(() => {
  setThemeRegistry(null);
  vi.unstubAllGlobals();
  prefs({
    networkEnabled: true,
    networkAllowThemes: undefined,
    themesPreviews: true,
  });
});

describe("ThemeBrowserDialog", () => {
  it("asks for consent first, makes no call, then Allow loads the grid", async () => {
    prefs({ networkEnabled: true, networkAllowThemes: undefined });
    render(<ThemeBrowserDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("theme-browser-consent")).toBeTruthy();
    expect(catalogue.cached).not.toHaveBeenCalled();
    expect(catalogue.refresh).not.toHaveBeenCalled();
    expect(install.installed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(getPreferences().networkAllowThemes).toBe(true);
    await screen.findByTestId("theme-card-Vesper");
    expect(catalogue.refresh).toHaveBeenCalledTimes(1);
  });

  it("renders cards with author, description, credit and licence, and the count", async () => {
    await openReady();
    const card = screen.getByTestId("theme-card-Vesper");
    expect(card.textContent).toMatch(/Vesper/);
    expect(card.textContent).toMatch(/Rauno/);
    expect(card.textContent).toMatch(/Warm dark theme/);
    expect(card.textContent).toMatch(/Credit: Rauno Freiberg\./);
    expect(card.textContent).toMatch(/Licence: MIT\./);
    expect(screen.getByTestId("theme-card-Nordic").textContent).toMatch(
      /Licence: GPL/,
    );
    expect(screen.getByTestId("theme-browser-status").textContent).toMatch(
      /2 of 2 themes/,
    );
  });

  it("filters by search text, tag and mode", async () => {
    await openReady();
    fireEvent.change(screen.getByLabelText("Search themes"), {
      target: { value: "arctic" },
    });
    expect(names()).toEqual(["Nordic"]);
    expect(screen.getByTestId("theme-browser-status").textContent).toMatch(
      /1 of 2 themes/,
    );

    fireEvent.change(screen.getByLabelText("Search themes"), {
      target: { value: "zzz" },
    });
    expect(names()).toEqual([]);
    expect(screen.getByText("No theme matches.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search themes"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Tag"), {
      target: { value: "warm" },
    });
    expect(names()).toEqual(["Vesper"]);

    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Mode"), {
      target: { value: "light" },
    });
    expect(names()).toEqual(["Nordic"]);
  });

  it("ArrowRight moves the selection and Enter installs the selected theme", async () => {
    await openReady();
    expect(
      screen.getByTestId("theme-card-Vesper").getAttribute("aria-selected"),
    ).toBe("true");
    key("ArrowRight");
    expect(
      screen.getByTestId("theme-card-Nordic").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("theme-card-Vesper").getAttribute("aria-selected"),
    ).toBe("false");

    key("ArrowLeft");
    key("Enter");
    await waitFor(() =>
      expect(screen.getByTestId("theme-card-Vesper").textContent).toMatch(
        /Installed/,
      ),
    );
    expect(install.fetch).toHaveBeenCalledWith(
      {
        kind: "url",
        url: entryUrl(getPreferences().themesIndexUrl, "Vesper/Vesper.json"),
      },
      expect.any(Number),
    );
    expect(install.write).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vesper",
        replace: false,
        source: expect.objectContaining({ sha256: SHA_V }),
      }),
    );
    expect(screen.getByTestId("theme-browser-status").textContent).toMatch(
      /Installed Vesper/,
    );
  });

  it("a hash mismatch shows an error and writes nothing", async () => {
    install = makeInstall({
      fetch: vi.fn(async (ref) => ({
        json: themeJson("Vesper"),
        sha256: "d".repeat(64),
        url: (ref as { url: string }).url,
      })),
    });
    await openReady();
    key("Enter");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/changed after the list was made/);
    expect(install.write).not.toHaveBeenCalled();
    expect(screen.getByTestId("theme-card-Vesper").textContent).not.toMatch(
      /Installed/,
    );
  });

  it("shows Update for a different installed hash and Enter writes with replace", async () => {
    installedList = [{ name: "Vesper", source: { sha256: SHA_NEW } }];
    await openReady();
    const card = screen.getByTestId("theme-card-Vesper");
    expect(card.textContent).toMatch(/Update/);
    key("Enter");
    await waitFor(() =>
      expect(install.write).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Vesper", replace: true }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("theme-browser-status").textContent).toMatch(
        /Updated Vesper/,
      ),
    );
  });

  it("Shift+Delete in the search box uninstalls; plain Delete does not", async () => {
    installedList = [{ name: "Vesper", source: { sha256: SHA_V } }];
    await openReady();
    expect(screen.getByTestId("theme-card-Vesper").textContent).toMatch(
      /Installed/,
    );
    key("Delete");
    expect(install.uninstall).not.toHaveBeenCalled();
    key("Delete", { shiftKey: true });
    await waitFor(() =>
      expect(install.uninstall).toHaveBeenCalledWith("Vesper"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("theme-card-Vesper").textContent).not.toMatch(
        /Installed/,
      ),
    );
  });

  it("Enter on an installed card selects the theme and closes", async () => {
    installedList = [{ name: "Vesper", source: { sha256: SHA_V } }];
    const onClose = vi.fn();
    const onThemeChanged = vi.fn();
    render(
      <ThemeBrowserDialog onClose={onClose} onThemeChanged={onThemeChanged} />,
    );
    await screen.findByTestId("theme-card-Vesper");
    key("Enter");
    expect(getPreferences().colorTheme).toBe("Vesper");
    expect(onThemeChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(install.write).not.toHaveBeenCalled();
  });

  it("offline with a cached list shows it and says it is the saved list", async () => {
    catalogue = makeCatalogue({
      cached: vi.fn(async () => raw([theme()], 1000)),
      refresh: vi.fn(async () => {
        throw new InstallError("NETWORK_ERROR", "Could not reach github.com");
      }),
    });
    await openReady();
    expect(catalogue.refresh).toHaveBeenCalled();
    const status = screen.getByTestId("theme-browser-status").textContent;
    expect(status).toMatch(/Offline\? Showing the list saved/);
    expect(status).toMatch(/Could not reach github\.com/);
  });

  it("offline with no cache shows an alert and Try again reloads", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(
        new InstallError("NETWORK_ERROR", "Could not reach github.com"),
      )
      .mockResolvedValue(raw([theme()]));
    catalogue = makeCatalogue({ refresh });
    render(<ThemeBrowserDialog onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Could not reach/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("theme-card-Vesper");
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("ThemeBrowserDialog previews", () => {
  const withPreview = () =>
    makeCatalogue({
      refresh: vi.fn(async () =>
        raw([theme({ previews: ["Vesper/shot.png"] })]),
      ),
    });

  class FakeObserver {
    static last: FakeObserver | null = null;
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {
      FakeObserver.last = this;
    }
    observe() {}
    disconnect() {}
    fire() {
      this.cb([{ isIntersecting: true }]);
    }
  }

  it("fetches no preview when previews are off", async () => {
    prefs({ themesPreviews: false });
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeObserver.last = null;
    catalogue = withPreview();
    await openReady();
    expect(FakeObserver.last).toBeNull();
    expect(catalogue.preview).not.toHaveBeenCalled();
  });

  it("fetches one preview from the entry url once the card is visible", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => "blob:x",
        revokeObjectURL: () => {},
      }),
    );
    FakeObserver.last = null;
    catalogue = withPreview();
    await openReady();
    expect(catalogue.preview).not.toHaveBeenCalled();
    act(() => FakeObserver.last!.fire());
    await waitFor(() => expect(catalogue.preview).toHaveBeenCalledTimes(1));
    expect(catalogue.preview).toHaveBeenCalledWith(
      entryUrl(getPreferences().themesIndexUrl, "Vesper/shot.png"),
      expect.any(Number),
    );
  });

  describe("rebindable keys", () => {
    const selected = (name: string) =>
      screen.getByTestId(`theme-card-${name}`).getAttribute("aria-selected");

    it("a [hotkeys] override replaces the default key", async () => {
      prefs({ hotkeys: { "themeBrowser.next": ["J"] } });
      await openReady();
      key("ArrowRight");
      expect(selected("Vesper")).toBe("true");
      key("j");
      expect(selected("Nordic")).toBe("true");
      prefs({ hotkeys: {} });
    });

    it("the commands and their context key exist only while the browser is open", async () => {
      const id = THEME_BROWSER_COMMAND_IDS.next;
      expect(getRegisteredHandler(id)).toBeUndefined();
      expect(readCustomContextKey(THEME_BROWSER_CONTEXT_KEY)).toBe(false);
      const view = render(<ThemeBrowserDialog onClose={vi.fn()} />);
      await screen.findByTestId("theme-card-Vesper");
      expect(readCustomContextKey(THEME_BROWSER_CONTEXT_KEY)).toBe(true);
      act(() => getRegisteredHandler(id)?.());
      expect(selected("Nordic")).toBe("true");
      act(() => getRegisteredHandler(THEME_BROWSER_COMMAND_IDS.prev)?.());
      expect(selected("Vesper")).toBe("true");
      view.unmount();
      expect(getRegisteredHandler(id)).toBeUndefined();
      expect(readCustomContextKey(THEME_BROWSER_CONTEXT_KEY)).toBe(false);
    });

    it("the close command closes the dialog", async () => {
      const onClose = vi.fn();
      render(<ThemeBrowserDialog onClose={onClose} />);
      await screen.findByTestId("theme-card-Vesper");
      act(() => getRegisteredHandler(THEME_BROWSER_COMMAND_IDS.close)?.());
      expect(onClose).toHaveBeenCalled();
    });
  });
});
