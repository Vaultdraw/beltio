//! Inline content of one text block, delivered as plain text with markers stripped, plus the
//! marked spans (`Inline`) and the document-level side effects (links, tags, counters).

use super::model::*;
use crate::links::grammar::pct_decode;
use crate::search::find_tags;
use pulldown_cmark::{Event, LinkType, Tag, TagEnd};
use std::collections::HashSet;
use std::ops::Range as StdRange;

/// Document-wide state shared by every block builder.
pub struct Ctx<'s> {
    pub src: &'s str,
    /// Bytes removed from the front of the source (a byte order mark); added to every range.
    pub base: usize,
    pub soft_break_newline: bool,
    pub links: Vec<DocLink>,
    pub tags: Vec<String>,
    pub tag_keys: HashSet<String>,
    pub words: usize,
    pub dropped_emphasis: usize,
    pub dropped_html: usize,
}

impl<'s> Ctx<'s> {
    pub fn range(&self, r: &StdRange<usize>) -> Range {
        [r.start + self.base, r.end + self.base]
    }
    pub fn add_tag(&mut self, name: &str) {
        if self.tag_keys.insert(crate::search::tag_key(name)) {
            self.tags.push(name.to_string());
        }
    }
}

const IMAGE_EXT: [&str; 9] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];

fn is_image_target(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    match name.rsplit_once('.') {
        Some((_, ext)) => IMAGE_EXT.iter().any(|e| ext.eq_ignore_ascii_case(e)),
        None => false,
    }
}

/// `Note#Heading` / `Note#^block` into (target, heading, blockRef).
/// Percent-decodes a relative path; URLs with a scheme are kept as written.
fn decode_dest(dest: &str) -> String {
    let scheme = dest.split(['/', '?', '#']).next().is_some_and(|h| h.contains(':'));
    if scheme { dest.to_string() } else { pct_decode(dest) }
}

pub fn split_target(dest: &str) -> (String, Option<String>, Option<String>) {
    match dest.split_once('#') {
        None => (dest.trim().to_string(), None, None),
        Some((t, frag)) => {
            let frag = frag.trim();
            match frag.strip_prefix('^') {
                Some(b) => (t.trim().to_string(), None, Some(b.to_string())),
                None if frag.is_empty() => (t.trim().to_string(), None, None),
                None => (t.trim().to_string(), Some(frag.to_string()), None),
            }
        }
    }
}

fn parse_size(s: &str) -> Option<(u32, Option<u32>)> {
    let s = s.trim();
    let (w, h) = match s.split_once('x') {
        Some((w, h)) => (w, Some(h)),
        None => (s, None),
    };
    let w: u32 = w.parse().ok()?;
    let h = match h {
        Some(h) => Some(h.parse().ok()?),
        None => None,
    };
    Some((w, h))
}

/// Splits `alt|100x200` (or `100`, or `alt`) into alt text and size.
fn alt_and_size(s: &str) -> (String, Option<u32>, Option<u32>) {
    let (alt, size) = match s.rsplit_once('|') {
        Some((a, last)) => match parse_size(last) {
            Some(sz) => (a, Some(sz)),
            None => (s, None),
        },
        None => match parse_size(s) {
            Some(sz) => ("", Some(sz)),
            None => (s, None),
        },
    };
    let (w, h) = size.map_or((None, None), |(w, h)| (Some(w), h));
    (alt.trim().to_string(), w, h)
}

struct WikiCap {
    dest: String,
    has_pothole: bool,
    range: StdRange<usize>,
    alias: String,
}

struct ImgCap {
    wiki: bool,
    has_pothole: bool,
    dest: String,
    range: StdRange<usize>,
    alt: String,
}

fn is_br(tag: &str) -> bool {
    let t = tag.trim();
    t.len() >= 3 && t.as_bytes()[0] == b'<' && t.as_bytes()[t.len() - 1] == b'>' && {
        let inner = t[1..t.len() - 1].trim().trim_end_matches('/').trim();
        inner.eq_ignore_ascii_case("br")
    }
}

/// Raw HTML to text: comments removed (counted), `<br>` as a newline, the rest as written.
pub fn html_to_text(html: &str, dropped: &mut usize) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        if let Some(body) = tail.strip_prefix("<!--") {
            *dropped += 1;
            match body.find("-->") {
                Some(j) => rest = &body[j + 3..],
                None => return out,
            }
            continue;
        }
        match tail.find('>') {
            Some(j) => {
                let tag = &tail[..=j];
                if is_br(tag) {
                    out.push('\n');
                } else {
                    out.push_str(tag);
                }
                rest = &tail[j + 1..];
            }
            None => {
                out.push_str(tail);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Removes `==highlight==` markers inside one string; returns how many pairs were removed.
fn strip_highlight(s: &str, out: &mut String) -> usize {
    let mut n = 0;
    let mut rest = s;
    while let Some(i) = rest.find("==") {
        let after = &rest[i + 2..];
        let ok_open = !after.starts_with(['=', ' ', '\t', '\n']);
        match after.find("==").filter(|_| ok_open) {
            Some(j) if j > 0 && !after[..j].ends_with([' ', '\t', '\n']) => {
                out.push_str(&rest[..i]);
                out.push_str(&after[..j]);
                rest = &after[j + 2..];
                n += 1;
            }
            _ => {
                out.push_str(&rest[..i + 2]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    n
}

#[derive(Default)]
pub struct Inl {
    text: String,
    /// Length of `text` in UTF-16 code units.
    u16len: usize,
    spans: Vec<Inline>,
    /// Byte ranges of `text` where a `#` must not start a tag (code, wikilinks, math).
    no_tag: Vec<(usize, usize)>,
    /// Finished pieces before the text being collected: text cut off at each embed or display
    /// formula, and the embed itself, in source order.
    parts: Vec<Piece>,
    link_stack: Vec<(usize, String)>,
    wiki: Option<WikiCap>,
    img: Option<ImgCap>,
    /// Inside a `%%comment%%` that has not closed yet.
    in_comment: bool,
    /// Inside a multi-line html comment.
    in_html_comment: bool,
    pub first_start: Option<usize>,
    /// A bare `^id` with no text before the end: names the block before it.
    pending_id: Option<String>,
}

/// One piece of a paragraph, in source order: a run of text, or an embed / display formula
/// that sat inside it (Obsidian shows them where they are written).
pub enum Piece {
    Text { text: String, inline: Vec<Inline> },
    Block(Block),
}

pub struct Finished {
    /// Never holds an empty text piece.
    pub pieces: Vec<Piece>,
    /// The trailing `^block-id` of the last piece.
    pub block_id: Option<String>,
}

impl Finished {
    /// Turns the pieces into blocks in source order; `make(text, inline, first)` builds the block
    /// for a text piece (`first`: it is the first block). The `^block-id` goes on the last block.
    pub fn into_blocks(self, range: Range, mut make: impl FnMut(String, Vec<Inline>, bool) -> BlockKind) -> Vec<Block> {
        let mut out: Vec<Block> = Vec::with_capacity(self.pieces.len());
        for p in self.pieces {
            match p {
                Piece::Text { text, inline } => {
                    let first = out.is_empty();
                    out.push(Block { range, kind: make(text, inline, first), block_id: None });
                }
                Piece::Block(b) => out.push(b),
            }
        }
        if let Some(last) = out.last_mut() {
            last.block_id = self.block_id;
        }
        out
    }

    /// The text of every text piece joined by a space, and the other blocks: for places that
    /// keep one string (table cells, a callout title).
    pub fn flat(self) -> (String, Vec<Block>) {
        let mut text = String::new();
        let mut blocks = Vec::new();
        for p in self.pieces {
            match p {
                Piece::Text { text: t, .. } => {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(&t);
                }
                Piece::Block(b) => blocks.push(b),
            }
        }
        (text, blocks)
    }
}

impl Inl {
    pub fn new() -> Self {
        Self::default()
    }

    fn push(&mut self, s: &str) {
        self.text.push_str(s);
        self.u16len += if s.is_ascii() { s.len() } else { s.encode_utf16().count() };
    }

    /// Text outside code: drops `%%comments%%` and strips `==highlights==`.
    fn push_prose(&mut self, ctx: &mut Ctx, t: &str) {
        let mut rest = t;
        loop {
            match rest.find("%%") {
                Some(i) => {
                    if !self.in_comment {
                        self.push_hl(ctx, &rest[..i]);
                    }
                    self.in_comment = !self.in_comment;
                    rest = &rest[i + 2..];
                }
                None => {
                    if !self.in_comment {
                        self.push_hl(ctx, rest);
                    }
                    return;
                }
            }
        }
    }

    fn push_hl(&mut self, ctx: &mut Ctx, t: &str) {
        if !t.contains("==") {
            self.push(t);
            return;
        }
        let mut tmp = String::with_capacity(t.len());
        ctx.dropped_emphasis += strip_highlight(t, &mut tmp);
        self.push(&tmp);
    }

    /// Feeds one inline event; returns false when `ev` is not inline content.
    pub fn feed(&mut self, ctx: &mut Ctx, ev: Event, range: &StdRange<usize>) -> bool {
        if self.first_start.is_none() {
            self.first_start = Some(range.start);
        }
        if let Some(w) = self.wiki.as_mut() {
            match ev {
                Event::Text(t) => w.alias.push_str(&t),
                Event::End(TagEnd::Link) => self.end_wiki(ctx),
                _ => {}
            }
            return true;
        }
        if let Some(img) = self.img.as_mut() {
            match ev {
                Event::Text(t) | Event::Code(t) => img.alt.push_str(&t),
                Event::End(TagEnd::Image) => self.end_image(ctx),
                _ => {}
            }
            return true;
        }
        if self.in_html_comment {
            if let Event::InlineHtml(h) | Event::Html(h) | Event::Text(h) = &ev {
                if h.contains("-->") {
                    self.in_html_comment = false;
                }
            }
            return matches!(ev, Event::InlineHtml(_) | Event::Html(_) | Event::Text(_) | Event::SoftBreak | Event::HardBreak);
        }
        match ev {
            Event::Text(t) => self.push_prose(ctx, &t),
            Event::Code(c) => {
                if !self.in_comment {
                    let s = self.text.len();
                    self.push(&c);
                    self.no_tag.push((s, self.text.len()));
                }
            }
            Event::InlineMath(m) => {
                if !self.in_comment {
                    let start = self.u16len;
                    let s = self.text.len();
                    self.push("$");
                    self.push(&m);
                    self.push("$");
                    self.no_tag.push((s, self.text.len()));
                    self.spans.push(Inline {
                        kind: InlineKind::Math,
                        start,
                        end: self.u16len,
                        target: m.to_string(),
                        alias: None,
                        heading: None,
                        block_ref: None,
                    });
                }
            }
            Event::DisplayMath(m) => {
                let block = Block {
                    range: ctx.range(range),
                    kind: BlockKind::Math { latex: m.trim().replace('\r', "") },
                    block_id: None,
                };
                self.cut(ctx, block);
            }
            Event::FootnoteReference(l) => {
                if !self.in_comment {
                    let start = self.u16len;
                    self.push("[");
                    self.push(&l);
                    self.push("]");
                    self.spans.push(Inline {
                        kind: InlineKind::FootnoteRef,
                        start,
                        end: self.u16len,
                        target: l.to_string(),
                        alias: None,
                        heading: None,
                        block_ref: None,
                    });
                }
            }
            Event::SoftBreak => {
                if !self.in_comment {
                    self.push(if ctx.soft_break_newline { "\n" } else { " " });
                }
            }
            Event::HardBreak => {
                if !self.in_comment {
                    self.push("\n");
                }
            }
            Event::InlineHtml(h) | Event::Html(h) => {
                if !self.in_comment {
                    if h.trim_start().starts_with("<!--") && !h.contains("-->") {
                        self.in_html_comment = true;
                        ctx.dropped_html += 1;
                    } else {
                        let t = html_to_text(&h, &mut ctx.dropped_html);
                        self.push(&t);
                    }
                }
            }
            Event::Start(tag) => return self.start(ctx, tag, range),
            Event::End(end) => match end {
                TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Superscript | TagEnd::Subscript => {}
                TagEnd::Link => {
                    if let Some((start, target)) = self.link_stack.pop().filter(|(s, _)| *s <= self.u16len) {
                        self.spans.push(Inline {
                            kind: InlineKind::Link,
                            start,
                            end: self.u16len,
                            target,
                            alias: None,
                            heading: None,
                            block_ref: None,
                        });
                    }
                }
                _ => return false,
            },
            _ => return false,
        }
        true
    }

    fn start(&mut self, ctx: &mut Ctx, tag: Tag, range: &StdRange<usize>) -> bool {
        match tag {
            Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Superscript | Tag::Subscript => {
                ctx.dropped_emphasis += 1;
            }
            Tag::Link { link_type: LinkType::WikiLink { has_pothole }, dest_url, .. } => {
                self.wiki = Some(WikiCap { dest: dest_url.trim_end_matches('\\').to_string(), has_pothole, range: range.clone(), alias: String::new() });
            }
            Tag::Link { dest_url, .. } => {
                let target = decode_dest(&dest_url);
                ctx.links.push(DocLink {
                    kind: DocLinkKind::Link,
                    target: target.clone(),
                    alias: None,
                    heading: None,
                    block_ref: None,
                    range: ctx.range(range),
                });
                self.link_stack.push((self.u16len, target));
            }
            Tag::Image { link_type, dest_url, .. } => {
                let (wiki, has_pothole) = match link_type {
                    LinkType::WikiLink { has_pothole } => (true, has_pothole),
                    _ => (false, true),
                };
                // In a table cell Obsidian wants `\|` for the alias bar: the backslash is not part of the target.
                let dest = if wiki { dest_url.trim_end_matches('\\').to_string() } else { dest_url.to_string() };
                self.img = Some(ImgCap { wiki, has_pothole, dest, range: range.clone(), alt: String::new() });
            }
            _ => return false,
        }
        true
    }

    fn end_wiki(&mut self, ctx: &mut Ctx) {
        let Some(w) = self.wiki.take() else { return };
        let literal = &ctx.src[w.range.clone()];
        let (target, heading, block_ref) = split_target(&w.dest);
        let alias = if w.has_pothole { Some(w.alias.clone()).filter(|a| !a.is_empty()) } else { None };
        let start = self.u16len;
        let s = self.text.len();
        if !self.in_comment {
            self.push(literal);
            self.no_tag.push((s, self.text.len()));
            self.spans.push(Inline {
                kind: InlineKind::Wikilink,
                start,
                end: self.u16len,
                target: target.clone(),
                alias: alias.clone(),
                heading: heading.clone(),
                block_ref: block_ref.clone(),
            });
        }
        ctx.links.push(DocLink { kind: DocLinkKind::Wikilink, target, alias, heading, block_ref, range: ctx.range(&w.range) });
    }

    fn end_image(&mut self, ctx: &mut Ctx) {
        let Some(img) = self.img.take() else { return };
        if self.in_comment {
            return;
        }
        let (alt, width, height) = if img.wiki && !img.has_pothole { (String::new(), None, None) } else { alt_and_size(&img.alt) };
        let range = ctx.range(&img.range);
        if img.wiki {
            let (target, heading, block_ref) = split_target(&img.dest);
            ctx.links.push(DocLink {
                kind: DocLinkKind::Embed,
                target: target.clone(),
                alias: Some(alt.clone()).filter(|a| !a.is_empty()),
                heading: heading.clone(),
                block_ref: block_ref.clone(),
                range,
            });
            let kind = if is_image_target(&target) {
                BlockKind::Image { target, remote: false, alt, width, height }
            } else {
                BlockKind::Embed { target, heading, block_ref, alt, width, height }
            };
            self.cut(ctx, Block { range, kind, block_id: None });
        } else {
            let target = decode_dest(&img.dest);
            let lower = target.to_ascii_lowercase();
            let remote = lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("data:");
            ctx.links.push(DocLink { kind: DocLinkKind::Embed, target: target.clone(), alias: None, heading: None, block_ref: None, range });
            let kind = if remote || is_image_target(split_target(&target).0.as_str()) {
                BlockKind::Image { target, remote, alt, width, height }
            } else {
                let (t, heading, block_ref) = split_target(&target);
                BlockKind::Embed { target: t, heading, block_ref, alt, width, height }
            };
            self.cut(ctx, Block { range, kind, block_id: None });
        }
    }

    /// An embed or display formula ends the text so far: it becomes a piece, then the block.
    fn cut(&mut self, ctx: &mut Ctx, block: Block) {
        if let Some((text, inline, _)) = self.drain_text(ctx, false) {
            self.parts.push(Piece::Text { text, inline });
        }
        self.parts.push(Piece::Block(block));
    }

    /// Ends the block: the pieces in source order, the last text trimmed with its `^block-id`
    /// pulled off and its `#tags` found outside code.
    pub fn finish(mut self, ctx: &mut Ctx) -> Finished {
        let mut block_id = None;
        if let Some((text, inline, id)) = self.drain_text(ctx, true) {
            self.parts.push(Piece::Text { text, inline });
            block_id = id;
        } else if let Some(id) = self.pending_id.take() {
            block_id = Some(id);
        }
        Finished { pieces: self.parts, block_id }
    }

    /// Takes the text collected so far (trimmed; `last` also pulls off a `^block-id`). None when
    /// nothing is left; a bare `^id` is kept in `pending_id`.
    fn drain_text(&mut self, ctx: &mut Ctx, last: bool) -> Option<(String, Vec<Inline>, Option<String>)> {
        let mut text = std::mem::take(&mut self.text);
        let mut spans = std::mem::take(&mut self.spans);
        let mut no_tag = std::mem::take(&mut self.no_tag);
        self.u16len = 0;
        let lead = text.len() - text.trim_start().len();
        if lead > 0 {
            let lead16 = text[..lead].encode_utf16().count();
            text.drain(..lead);
            for s in &mut spans {
                s.start = s.start.saturating_sub(lead16);
                s.end = s.end.saturating_sub(lead16);
            }
            for r in &mut no_tag {
                r.0 = r.0.saturating_sub(lead);
                r.1 = r.1.saturating_sub(lead);
            }
        }
        text.truncate(text.trim_end().len());
        let block_id = if last { take_block_id(&mut text) } else { None };
        if text.is_empty() {
            self.pending_id = block_id;
            return None;
        }
        ctx.words += text.split_whitespace().count();
        let ascii = text.is_ascii();
        let mut tag_spans = Vec::new();
        for m in find_tags(&text) {
            if no_tag.iter().any(|&(a, b)| m.range.0 >= a && m.range.0 < b) {
                continue;
            }
            let start = if ascii { m.range.0 } else { text[..m.range.0].encode_utf16().count() };
            let end = if ascii { m.range.1 } else { text[..m.range.1].encode_utf16().count() };
            ctx.add_tag(m.display);
            tag_spans.push(Inline { kind: InlineKind::Tag, start, end, target: m.display.to_string(), alias: None, heading: None, block_ref: None });
        }
        spans.extend(tag_spans);
        spans.sort_by_key(|s| (s.start, s.end));
        Some((text, spans, block_id))
    }
}

/// `text ^abc-1` -> removes the id and returns it. Also `^abc` alone returns the id and clears.
fn take_block_id(text: &mut String) -> Option<String> {
    let t = text.as_str();
    let start = t.rfind(|c: char| c.is_whitespace()).map_or(0, |i| i + t[i..].chars().next().map_or(1, char::len_utf8));
    let tok = &t[start..];
    let id = tok.strip_prefix('^')?;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return None;
    }
    let id = id.to_string();
    text.truncate(start);
    text.truncate(text.trim_end().len());
    Some(id)
}

#[cfg(test)]
mod alt_size_parity {
    /// One table for the Rust parser and the importer's TypeScript copy (bug hunt BH-1: the
    /// copy drifted and read "Photo 3" as 3 px wide). The TS test reads the same file.
    #[test]
    fn alt_and_size_matches_the_shared_table() {
        let cases: Vec<(String, String, Option<u32>, Option<u32>)> =
            serde_json::from_str(include_str!("alt_size_cases.json")).unwrap();
        for (input, alt, w, h) in cases {
            assert_eq!(super::alt_and_size(&input), (alt, w, h), "{input:?}");
        }
    }
}
