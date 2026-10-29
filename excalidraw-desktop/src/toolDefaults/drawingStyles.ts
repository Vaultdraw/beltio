/**
 * Per-drawing style overrides: the styles picked inside one drawing, per tool
 * and per key (same snake_case keys as [tools.*]). Pure data: no React, no
 * editor. Stored in the .excalidraw file as a top-level
 *
 *   "vaultdraw": { "styles": { "arrow": { "stroke_color": "#f08c00" } } }
 *
 * block that the serializer appends as the LAST key, so it can be read from
 * the file tail without parsing the (possibly huge) scene.
 */
import { toAsciiJson } from "../vault/asciiJson";

import {
  STYLE_KEY_RULES,
  TOOL_DEFAULT_TOOLS,
  TOOL_STYLE_KEYS,
  isEmptyStyle,
  isStyledTool,
  orderedStyle,
  type StyledTool,
  type ToolDefaults,
  type ToolStyle,
  type ToolStyleKey,
} from "./toolStyles";

export type DrawingStyles = Partial<Record<StyledTool, ToolStyle>>;

const BLOCK_KEY = '"vaultdraw":';
/** The block is a few hundred bytes (6 tools x <= 8 keys); this is plenty. */
const TAIL_CHARS = 8192;

export const isEmptyDrawingStyles = (styles: DrawingStyles): boolean =>
  TOOL_DEFAULT_TOOLS.every((tool) => isEmptyStyle(styles[tool]));

/** Only known tools and keys with valid values; everything else is dropped. */
export function sanitizeDrawingStyles(value: unknown): DrawingStyles {
  const out: DrawingStyles = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  for (const [tool, raw] of Object.entries(value)) {
    if (!isStyledTool(tool) || !raw || typeof raw !== "object") {
      continue;
    }
    const style: Record<string, unknown> = {};
    for (const key of TOOL_STYLE_KEYS[tool]) {
      const v = (raw as Record<string, unknown>)[key];
      if (v !== undefined && STYLE_KEY_RULES[key].valid(v)) {
        style[key] = v;
      }
    }
    if (Object.keys(style).length > 0) {
      out[tool] = orderedStyle(tool, style as ToolStyle);
    }
  }
  return out;
}

/**
 * The drawing's overrides from its file text. Looks at the tail only; a file
 * without the block, or one that does not look as expected, gives {}.
 */
export function readDrawingStyles(json: string): DrawingStyles {
  return sanitizeDrawingStyles(readBlock(json)?.styles);
}

/**
 * The drawing's own Markdown mode switch (`"vaultdraw": {"markdown": true}`),
 * or null when the drawing has none (it follows `markdown.typing`).
 */
export function readDrawingMarkdown(json: string): boolean | null {
  const value = readBlock(json)?.markdown;
  return typeof value === "boolean" ? value : null;
}

/** The trailing `vaultdraw` block, parsed, or null. */
function readBlock(json: string): Record<string, unknown> | null {
  try {
    const tail = json.length > TAIL_CHARS ? json.slice(-TAIL_CHARS) : json;
    const at = tail.lastIndexOf(BLOCK_KEY);
    if (at < 0) {
      return null;
    }
    // `"vaultdraw": {...}\n}`: the object runs up to the final top-level brace.
    const rest = tail.slice(at + BLOCK_KEY.length).trimEnd();
    if (!rest.endsWith("}")) {
      return null;
    }
    const block = JSON.parse(rest.slice(0, -1)) as unknown;
    return block && typeof block === "object" && !Array.isArray(block)
      ? (block as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * `json` with the block inserted before its final `\n}` (the input itself,
 * byte for byte, when there is nothing to store or the text is not the
 * editor's own two-space output).
 */
export function appendDrawingStyles(
  json: string,
  styles: DrawingStyles,
  markdown: boolean | null = null,
): string {
  const clean = sanitizeDrawingStyles(styles);
  const noStyles = isEmptyDrawingStyles(clean);
  if ((noStyles && markdown === null) || !json.endsWith("\n}")) {
    return json;
  }
  const ordered: Record<string, ToolStyle> = {};
  for (const tool of TOOL_DEFAULT_TOOLS) {
    if (clean[tool]) {
      ordered[tool] = clean[tool]!;
    }
  }
  const content: Record<string, unknown> = noStyles ? {} : { styles: ordered };
  if (markdown !== null) {
    content.markdown = markdown;
  }
  const block = toAsciiJson(
    JSON.stringify(content, null, 2).replace(/\n/g, "\n  "),
  );
  return `${json.slice(0, -2)},\n  ${BLOCK_KEY} ${block}\n}`;
}

/** The style a tool starts with: its effective default, then this drawing's picks. */
export const effectiveToolStyle = (
  defaults: ToolDefaults,
  drawing: DrawingStyles,
  tool: StyledTool,
): ToolStyle => ({ ...defaults[tool], ...drawing[tool] });

/** Effective style of every tool that has one (empty tools omitted). */
export function effectiveToolStyles(
  defaults: ToolDefaults,
  drawing: DrawingStyles,
): ToolDefaults {
  const out: ToolDefaults = {};
  for (const tool of TOOL_DEFAULT_TOOLS) {
    const style = effectiveToolStyle(defaults, drawing, tool);
    if (!isEmptyStyle(style)) {
      out[tool] = style;
    }
  }
  return out;
}

/** New styles with `tool.key = value` (same object when nothing changes). */
export function setDrawingStyle(
  styles: DrawingStyles,
  tool: StyledTool,
  key: ToolStyleKey,
  value: unknown,
): DrawingStyles {
  if (!STYLE_KEY_RULES[key].valid(value) || styles[tool]?.[key] === value) {
    return styles;
  }
  return {
    ...styles,
    [tool]: orderedStyle(tool, { ...styles[tool], [key]: value } as ToolStyle),
  };
}

/** New styles without `keys` of `tools` (same object when none was set). */
export function clearDrawingStyle(
  styles: DrawingStyles,
  tools: readonly StyledTool[],
  keys?: readonly ToolStyleKey[],
): DrawingStyles {
  let next = styles;
  for (const tool of tools) {
    const style = next[tool];
    if (!style) {
      continue;
    }
    const drop = keys ?? (Object.keys(style) as ToolStyleKey[]);
    if (!drop.some((key) => style[key] !== undefined)) {
      continue;
    }
    const rest: Record<string, unknown> = { ...style };
    for (const key of drop) {
      delete rest[key];
    }
    const { [tool]: _gone, ...others } = next;
    next =
      Object.keys(rest).length > 0
        ? { ...others, [tool]: rest as ToolStyle }
        : others;
  }
  return next;
}
