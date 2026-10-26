//! Markdown to `NoteDoc`: a pure parse of one note (CommonMark + GFM tables, task lists,
//! strikethrough, footnotes, math, wikilinks and frontmatter through pulldown-cmark) followed
//! by our Obsidian pass (callouts, `#tags`, `%%comments%%`, `==highlight==`, `^block-ids`,
//! embed sizes). Inline content is plain text with marked spans. The TypeScript mirror is `NoteDoc` in `sdk/api/src/markdown.ts`.

mod blocks;
mod frontmatter;
mod inline;
mod model;
mod reader;
#[cfg(test)]
mod tests;

pub use model::*;
pub use reader::{parse_markdown_file, read_markdown_file, MAX_MARKDOWN_BYTES};

use inline::Ctx;
use pulldown_cmark::{Options, Parser};
use std::collections::HashSet;

fn count_blocks(blocks: &[Block]) -> usize {
    blocks
        .iter()
        .map(|b| {
            1 + match &b.kind {
                BlockKind::Blockquote { blocks } | BlockKind::Callout { blocks, .. } | BlockKind::FootnoteDef { blocks, .. } => count_blocks(blocks),
                _ => 0,
            }
        })
        .sum()
}

/// Parses `text` into a `NoteDoc`. Byte ranges refer to `text` as given.
pub fn parse_markdown(text: &str, opts: &ParseOptions) -> NoteDoc {
    let (base, body) = match text.strip_prefix('\u{feff}') {
        Some(rest) => (3, rest),
        None => (0, text),
    };
    let flags = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_MATH
        | Options::ENABLE_WIKILINKS;
    let ctx = Ctx {
        src: body,
        base,
        soft_break_newline: opts.soft_break_newline,
        links: Vec::new(),
        tags: Vec::new(),
        tag_keys: HashSet::new(),
        words: 0,
        dropped_emphasis: 0,
        dropped_html: 0,
    };
    let mut walk = blocks::Walk::new(Parser::new_ext(body, flags), ctx);
    let blocks = walk.run();
    let stats = Stats {
        words: walk.ctx.words,
        blocks: count_blocks(&blocks),
        dropped_emphasis: walk.ctx.dropped_emphasis,
        dropped_html: walk.ctx.dropped_html,
    };
    NoteDoc {
        schema_version: SCHEMA_VERSION,
        frontmatter: walk.frontmatter,
        blocks,
        links: walk.ctx.links,
        tags: walk.ctx.tags,
        stats,
    }
}
