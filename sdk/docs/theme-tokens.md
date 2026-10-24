<!-- Generated from sdk/api/src/theme.ts by sdk/api/scripts/gen-theme-docs.mjs. Do not edit. -->

# Theme tokens

The colours `ctx.theme.tokens()` returns, 41 in all. Each value is a CSS string: most are `#rrggbb`, some are `rgba(...)` colours or shadows. Use one as `var(--vault-text)` in CSS, or read the string from `ctx.theme.tokens()["--vault-text"]`.

The names are part of the API. A token is added with a line here and is never removed without an alias.

| Token | Use |
| --- | --- |
| `--vault-canvas` | The drawing canvas background. |
| `--vault-bg` | The app background; the same colour as the canvas. |
| `--vault-surface` | Header, sidebar and panels. |
| `--vault-surface-hover` | A surface under the pointer. |
| `--vault-surface-active` | A pressed or selected surface. |
| `--vault-border` | Hairlines between areas. |
| `--vault-border-strong` | Borders of inputs and buttons. |
| `--vault-menu-bg` | Menus, popovers and dialogs. |
| `--vault-text` | Body text. |
| `--vault-text-muted` | Secondary text. |
| `--vault-text-faint` | Hints and disabled text. |
| `--vault-primary` | The accent colour: primary buttons, links, focus. |
| `--vault-primary-hover` | The accent under the pointer. |
| `--vault-primary-active` | The accent while pressed. |
| `--vault-primary-light` | A light tint of the accent for fills. |
| `--vault-primary-border` | A border in the accent family. |
| `--vault-on-primary` | Text on an accent fill. |
| `--vault-on-danger` | Text on a danger fill. |
| `--vault-accent-text` | The accent, adjusted to read as text on the background. |
| `--vault-success` | Success text and icons. |
| `--vault-success-bg` | Success background. |
| `--vault-success-border` | Success border. |
| `--vault-warning` | Warning text and icons. |
| `--vault-warning-bg` | Warning background. |
| `--vault-warning-border` | Warning border. |
| `--vault-danger` | Error and destructive text, icons and fills. |
| `--vault-danger-bg` | Error background. |
| `--vault-danger-border` | Error border. |
| `--vault-danger-hover` | A danger fill under the pointer. |
| `--vault-shadow-sm` | Small elevation shadow (a CSS box-shadow value). |
| `--vault-shadow-md` | Medium elevation shadow (a CSS box-shadow value). |
| `--vault-shadow-lg` | Large elevation shadow (a CSS box-shadow value). |
| `--vault-shadow-island` | Shadow of the floating toolbars (a CSS box-shadow value). |
| `--vault-shadow-pop` | Shadow of popovers (a CSS box-shadow value). |
| `--vault-scrim` | The dim layer behind a dialog (an rgba colour). |
| `--vault-hover` | A translucent hover tint (an rgba colour). |
| `--vault-chip` | A translucent chip or tag fill (an rgba colour). |
| `--vault-chip-strong` | A stronger chip fill (an rgba colour). |
| `--vault-sel` | A translucent selection tint (an rgba colour). |
| `--vault-sel-strong` | A stronger selection tint (an rgba colour). |
| `--vault-ring` | The focus ring (an rgba colour). |
