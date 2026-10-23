/**
 * Themes that used to be bundled with the app and now live in
 * https://github.com/Vaultdraw/themes (themes-10). A config.toml that still
 * names one of them gets a one-click "Install it" instead of a bare warning.
 * About 2 KB; the names are the repo's folder names.
 */

import { slugify } from "./normalize";

export const THEMES_REPO = "Vaultdraw/themes";
export const THEMES_REPO_URL = `https://github.com/${THEMES_REPO}`;

const REMOVED: readonly string[] = [
  "ADW",
  "Alpenglow",
  "Atuel",
  "Aura",
  "Ayu",
  "Ayu Blue",
  "Ayu Green",
  "Ayu Red",
  "Breeze",
  "Catppuccin Frappe Blue",
  "Catppuccin Frappe Green",
  "Catppuccin Frappe Lavender",
  "Catppuccin Frappe Mauve",
  "Catppuccin Frappe Peach",
  "Catppuccin Frappe Pink",
  "Catppuccin Frappe Rosewater",
  "Catppuccin Frappe Sapphire",
  "Catppuccin Macchiato Blue",
  "Catppuccin Macchiato Green",
  "Catppuccin Macchiato Lavender",
  "Catppuccin Macchiato Mauve",
  "Catppuccin Macchiato Peach",
  "Catppuccin Macchiato Pink",
  "Catppuccin Macchiato Rosewater",
  "Catppuccin Macchiato Sapphire",
  "Catppuccin Mocha Blue",
  "Catppuccin Mocha Green",
  "Catppuccin Mocha Lavender",
  "Catppuccin Mocha Maroon",
  "Catppuccin Mocha Mauve-Lavender",
  "Catppuccin Mocha Peach",
  "Catppuccin Mocha Pink",
  "Catppuccin Mocha Rosewater",
  "Catppuccin Mocha Sapphire",
  "Cendre",
  "Cendre Medium",
  "Cendre Soft",
  "Cherry Blossom",
  "Coral and Sea",
  "Cream",
  "Cream Autumn",
  "Creamy Forest",
  "Cyberpunk",
  "Doomed",
  "Eldritch",
  "Espresso Cream",
  "Everdeer",
  "Everforest Material",
  "Flexoki",
  "Garnet",
  "GitHub Dark",
  "Gruber Darker",
  "Gruvbox Material",
  "Gruvbox Material Hard",
  "Gruvbox Material Medium",
  "GruvboxAlt",
  "Heartbox",
  "Hexa34C",
  "Horizon",
  "Inabakumori",
  "Jiva",
  "Jiva Lotus",
  "Jiva Paper",
  "Kanagawa Dragon",
  "Kanagawa Kasumi",
  "Kanagawa Paper",
  "Kemuri",
  "Kemuri Koke",
  "Kemuri Susu",
  "Kitten",
  "Koneko",
  "Lilac AMOLED",
  "Macaron",
  "Matecito",
  "Miasma",
  "Mine",
  "Mizuki-Akiyama",
  "Monochrome",
  "Murasaki",
  "Murata",
  "NaySayer",
  "Neon Surf",
  "Noctalia",
  "Noctalia legacy",
  "Nord Aurora",
  "Oasis Abyss",
  "Occult Umbral",
  "One Dark Two",
  "Osaka jade",
  "Oxide",
  "Oxocarbon",
  "Paradise",
  "Peche",
  "Rose Pine Alt",
  "Rose Pine Moon",
  "Rose Pine Moon Alt",
  "Rosey AMOLED",
  "Rosé Pine",
  "SeaBed",
  "Seoul256",
  "Seoul256 Hard",
  "Seoul256 Soft",
  "Shien",
  "Shinonome",
  "Solarized Osaka",
  "Spiderman",
  "Sway Classic",
  "Tokyo Night Moon",
  "Tokyo Night Storm",
  "Tomorrow",
  "Vesper",
  "Zenbones",
];

let bySlug: Map<string, string> | null = null;

/** The repo name of a theme that used to be bundled, or null. */
export const removedThemeName = (selected: string): string | null => {
  bySlug ??= new Map(REMOVED.map((n) => [slugify(n), n]));
  return bySlug.get(slugify(selected)) ?? null;
};

/** Source string for the installer: owner/repo/<Name>. */
export const removedThemeSource = (name: string) => `${THEMES_REPO}/${name}`;

/** One line shown when the selected theme left the app (toast and Settings). */
export const removedNotice = (name: string) =>
  `"${name}" is no longer built in, so Default is shown. It is in`;
