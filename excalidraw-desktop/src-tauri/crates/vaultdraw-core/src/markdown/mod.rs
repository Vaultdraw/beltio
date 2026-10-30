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

/// The leading `---` block of `body`: where its closing `---` or `...` line ends, the length to
/// skip (that line's newline too) and the text between the two lines. The opening line is exactly
/// `---` (spaces after it allowed).
fn split_frontmatter(body: &str) -> Option<(usize, usize, &str)> {
    let first = body.find('\n')?;
    if body[..first].trim_end_matches(['\r', ' ', '\t']) != "---" {
        return None;
    }
    let inner = first + 1;
    let mut at = inner;
    while at <= body.len() {
        let end = body[at..].find('\n').map_or(body.len(), |i| at + i);
        let line = body[at..end].trim_end_matches(['\r', ' ', '\t']);
        if line == "---" || line == "..." {
            return Some((end, (end + 1).min(body.len()), &body[inner..at]));
        }
        if end == body.len() {
            return None;
        }
        at = end + 1;
    }
    None
}

/// Parses `text` into a `NoteDoc`. Byte ranges refer to `text` as given.
pub fn parse_markdown(text: &str, opts: &ParseOptions) -> NoteDoc {
    let (base, body) = match text.strip_prefix('\u{feff}') {
        Some(rest) => (3, rest),
        None => (0, text),
    };
    // Front matter by Obsidian's rule, the reading view's (contract/frontmatter_cases.json), not
    // pulldown-cmark's: its metadata block refused a blank first line and took a block after a
    // leading blank line (toimprove 215).
    let front = split_frontmatter(body).map(|(end, len, raw)| (len, frontmatter::parse(raw, [base, base + end])));
    let (base, body) = match &front {
        Some((len, _)) => (base + len, &body[*len..]),
        None => (base, body),
    };
    let flags = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
        | Options::ENABLE_WIKILINKS;
    let mut ctx = Ctx {
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
    let frontmatter = front.map(|(_, fm)| {
        for t in &fm.tags {
            ctx.add_tag(t);
        }
        fm
    });
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
        frontmatter,
        blocks,
        links: walk.ctx.links,
        tags: walk.ctx.tags,
        stats,
    }
}
