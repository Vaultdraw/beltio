# Formulas

LaTeX formulas in a drawing, and the TeX renderer behind `$…$` in notes.

Official plugin, on by default. Switch it off under **Settings → Extensions → Formulas** (or `[extensions] formula = false` in `config.toml`): MathJax never loads, the two commands disappear, and notes show the TeX source instead of the picture.

- **Formula: Insert formula** (`Mod+Shift+M`) and **Formula: Edit formula**; double-click a formula to edit it.
- A formula is an ordinary image element (an SVG) with its TeX in the element's `latex` data. A drawing opens everywhere without the plugin and shows the last picture.
- MathJax runs in a worker, started on the first render and stopped after five idle minutes.
- Provides `ctx.math.render` (API 0.23.0) for the notes view and other plugins.
