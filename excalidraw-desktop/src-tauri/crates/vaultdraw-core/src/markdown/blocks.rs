//! The block walk: turns pulldown-cmark events into `Block`s, including our own callout pass
//! over blockquotes.

use super::frontmatter;
use super::inline::{html_to_text, Ctx, Finished, Inl, Piece};
use super::model::*;
use pulldown_cmark::{Alignment, CodeBlockKind, CowStr, Event, OffsetIter, Parser as Md, Tag, TagEnd};
use std::ops::Range as StdRange;

type Item<'a> = (Event<'a>, StdRange<usize>);

pub struct Walk<'a, 's> {
    it: OffsetIter<'a, pulldown_cmark::DefaultBrokenLinkCallback>,
    queue: std::collections::VecDeque<Item<'a>>,
    pub ctx: Ctx<'s>,
    pub frontmatter: Option<Frontmatter>,
    /// Open containers we kept, and deeper ones we dropped (see `MAX_NEST`).
    kept: usize,
    skipped: usize,
}

/// Containers (quotes, lists, items) nested deeper than this are flattened into their parent: the
/// walk below recurses once per kept level, so an unbounded note (a line of `>` characters) would
/// overflow the stack and abort the app. CommonMark parsers cap nesting the same way.
pub const MAX_NEST: usize = 64;

fn is_container_start(t: &Tag) -> bool {
    matches!(t, Tag::BlockQuote(_) | Tag::List(_) | Tag::Item | Tag::FootnoteDefinition(_) | Tag::DefinitionList | Tag::DefinitionListDefinition)
}

fn is_container_end(t: &TagEnd) -> bool {
    matches!(t, TagEnd::BlockQuote(_) | TagEnd::List(_) | TagEnd::Item | TagEnd::FootnoteDefinition | TagEnd::DefinitionList | TagEnd::DefinitionListDefinition)
}

impl<'a, 's> Walk<'a, 's> {
    pub fn new(parser: Md<'a>, ctx: Ctx<'s>) -> Self {
        Walk { it: parser.into_offset_iter(), queue: Default::default(), ctx, frontmatter: None, kept: 0, skipped: 0 }
    }

    /// The parser's next event, with containers beyond `MAX_NEST` dropped (start and matching end).
    fn raw(&mut self) -> Option<Item<'a>> {
        loop {
            let (ev, r) = self.it.next()?;
            match &ev {
                Event::Start(t) if is_container_start(t) => {
                    if self.kept >= MAX_NEST {
                        self.skipped += 1;
                        continue;
                    }
                    self.kept += 1;
                }
                Event::End(t) if is_container_end(t) => {
                    if self.skipped > 0 {
                        self.skipped -= 1;
                        continue;
                    }
                    self.kept = self.kept.saturating_sub(1);
                }
                _ => {}
            }
            return Some((ev, r));
        }
    }

    /// Next event; adjacent text events are merged so markers like `%%` and `==` are not split.
    fn pull(&mut self) -> Option<Item<'a>> {
        let (ev, r) = self.raw()?;
        let Event::Text(first) = ev else { return Some((ev, r)) };
        let mut merged: Option<String> = None;
        let mut end = r.end;
        loop {
            match self.raw() {
                None => break,
                // An escaped `\#` stays its own event: merged, the escape would be lost and the
                // `#one` after it read as a tag (toimprove 322).
                Some((Event::Text(t), r2)) if super::inline::is_escaped_hash(self.ctx.src, &t, r2.start) => {
                    self.queue.push_back((Event::Text(t), r2));
                    break;
                }
                Some((Event::Text(t), r2)) => {
                    merged.get_or_insert_with(|| first.to_string()).push_str(&t);
                    end = r2.end;
                }
                Some(other) => {
                    self.queue.push_back(other);
                    break;
                }
            }
        }
        // `queue` now holds the first non-text event, delivered by the next call.
        let text = match merged {
            Some(s) => CowStr::from(s),
            None => first,
        };
        Some((Event::Text(text), r.start..end))
    }

    fn next(&mut self) -> Option<Item<'a>> {
        match self.queue.pop_front() {
            Some(i) => Some(i),
            None => self.pull(),
        }
    }

    fn peek(&mut self) -> Option<&Item<'a>> {
        if self.queue.is_empty() {
            let first = self.pull()?;
            self.queue.push_front(first);
        }
        self.queue.front()
    }

    pub fn run(&mut self) -> Vec<Block> {
        let mut out = Vec::new();
        self.children(&mut out, 0);
        out
    }

    /// Parses blocks until the end of the enclosing container (or the end of the input).
    fn children(&mut self, out: &mut Vec<Block>, depth: usize) {
        while let Some((ev, r)) = self.next() {
            if matches!(ev, Event::End(_)) {
                return;
            }
            self.block(ev, r, out, depth);
        }
    }

    fn push_text_block(&mut self, out: &mut Vec<Block>, range: Range, fin: Finished, make: impl FnMut(String, Vec<Inline>, Vec<Mark>, bool) -> BlockKind) {
        if fin.pieces.is_empty() {
            // A bare `^id` line names the block before it.
            if let (Some(id), Some(prev)) = (fin.block_id, out.last_mut()) {
                if prev.block_id.is_none() {
                    prev.block_id = Some(id);
                }
            }
            return;
        }
        out.extend(fin.into_blocks(range, make));
    }

    fn block(&mut self, ev: Event<'a>, r: StdRange<usize>, out: &mut Vec<Block>, depth: usize) {
        let range = self.ctx.range(&r);
        match ev {
            Event::Rule => out.push(Block { range, kind: BlockKind::ThematicBreak, block_id: None }),
            Event::Start(Tag::Paragraph) => {
                let fin = self.inline_run(|e| matches!(e, TagEnd::Paragraph));
                self.push_text_block(out, range, fin, |text, inline, marks, _| BlockKind::Paragraph { text, inline, marks });
            }
            Event::Start(Tag::Heading { level, .. }) => {
                let fin = self.inline_run(|e| matches!(e, TagEnd::Heading(_)));
                let level = level as u8;
                out.extend(fin.into_blocks(range, |text, inline, marks, first| {
                    if first { BlockKind::Heading { level, text, inline, marks } } else { BlockKind::Paragraph { text, inline, marks } }
                }));
            }
            Event::Start(Tag::BlockQuote(_)) => self.blockquote(r, range, out, depth),
            Event::Start(Tag::CodeBlock(kind)) => {
                let lang = match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().map(str::to_string),
                    CodeBlockKind::Indented => None,
                };
                let mut text = String::new();
                while let Some((ev, _)) = self.next() {
                    match ev {
                        Event::Text(t) => text.push_str(&t),
                        Event::End(_) => break,
                        _ => {}
                    }
                }
                text.retain(|c| c != '\r');
                if text.ends_with('\n') {
                    text.pop();
                }
                out.push(Block { range, kind: BlockKind::Code { code: true, lang, text }, block_id: None });
            }
            Event::Start(Tag::List(first)) => self.list(first.is_some(), out, depth),
            Event::Start(Tag::Table(aligns)) => self.table(range, aligns, out),
            Event::Start(Tag::HtmlBlock) => {
                let mut html = String::new();
                while let Some((ev, _)) = self.next() {
                    match ev {
                        Event::Html(h) | Event::Text(h) => html.push_str(&h),
                        Event::End(_) => break,
                        _ => {}
                    }
                }
                let text = html_to_text(&html.replace('\r', ""), &mut self.ctx.dropped_html);
                let text = text.trim_matches(['\n', ' ']).to_string();
                if !text.trim().is_empty() {
                    out.push(Block { range, kind: BlockKind::Html { text }, block_id: None });
                }
            }
            Event::Start(Tag::FootnoteDefinition(label)) => {
                let mut blocks = Vec::new();
                self.children(&mut blocks, 0);
                out.push(Block { range, kind: BlockKind::FootnoteDef { label: label.to_string(), blocks }, block_id: None });
            }
            Event::Start(Tag::MetadataBlock(_)) => {
                let mut raw = String::new();
                while let Some((ev, _)) = self.next() {
                    match ev {
                        Event::Text(t) => raw.push_str(&t),
                        Event::End(_) => break,
                        _ => {}
                    }
                }
                let fm = frontmatter::parse(&raw, range);
                for t in &fm.tags {
                    self.ctx.add_tag(t);
                }
                self.frontmatter = Some(fm);
            }
            Event::Start(_) => self.skip_container(),
            _ => {}
        }
    }

    /// Skips an unknown container (not enabled today, kept for pulldown-cmark upgrades).
    fn skip_container(&mut self) {
        let mut depth = 1;
        while let Some((ev, _)) = self.next() {
            match ev {
                Event::Start(_) => depth += 1,
                Event::End(_) => {
                    depth -= 1;
                    if depth == 0 {
                        return;
                    }
                }
                _ => {}
            }
        }
    }

    fn inline_run(&mut self, stop: impl Fn(&TagEnd) -> bool) -> Finished {
        let mut inl = Inl::new();
        while let Some((ev, r)) = self.next() {
            if let Event::End(e) = &ev {
                if stop(e) {
                    break;
                }
            }
            inl.feed(&mut self.ctx, ev, &r);
        }
        inl.finish(&mut self.ctx)
    }

    fn blockquote(&mut self, r: StdRange<usize>, range: Range, out: &mut Vec<Block>, depth: usize) {
        let head = callout_head(&self.ctx.src[r.start..]);
        let Some((ctype, fold, raw_title)) = head else {
            let mut blocks = Vec::new();
            self.children(&mut blocks, depth);
            out.push(Block { range, kind: BlockKind::Blockquote { blocks }, block_id: None });
            return;
        };
        let mut blocks = Vec::new();
        let mut title = String::new();
        if matches!(self.peek(), Some((Event::Start(Tag::Paragraph), _))) {
            self.next();
            let mut inl = Inl::new();
            let mut ended = false;
            while let Some((ev, r)) = self.next() {
                match ev {
                    Event::SoftBreak | Event::HardBreak => break,
                    Event::End(TagEnd::Paragraph) => {
                        ended = true;
                        break;
                    }
                    ev => {
                        inl.feed(&mut self.ctx, ev, &r);
                    }
                }
            }
            let fin = inl.finish(&mut self.ctx);
            let (fin_text, _, fin_blocks) = fin.flat();
            title = match fin_text.strip_prefix("[!").and_then(|t| t.split_once(']')) {
                Some((_, rest)) => rest.trim_start_matches(['+', '-']).trim().to_string(),
                None => raw_title.clone(),
            };
            blocks.extend(fin_blocks);
            if !ended {
                let mut inl = Inl::new();
                let mut end = 0;
                while let Some((ev, r)) = self.next() {
                    end = r.end;
                    if matches!(ev, Event::End(TagEnd::Paragraph)) {
                        break;
                    }
                    inl.feed(&mut self.ctx, ev, &r);
                }
                let start = inl.first_start.unwrap_or(end);
                let fin = inl.finish(&mut self.ctx);
                self.push_text_block(&mut blocks, self.ctx.range(&(start..end)), fin, |text, inline, marks, _| BlockKind::Paragraph { text, inline, marks });
            }
        }
        self.children(&mut blocks, depth);
        if title.is_empty() {
            title = capitalize(&ctype);
        }
        out.push(Block { range, kind: BlockKind::Callout { callout_type: ctype, title, fold_state: fold, blocks }, block_id: None });
    }

    fn list(&mut self, ordered: bool, out: &mut Vec<Block>, depth: usize) {
        while let Some((ev, r)) = self.next() {
            match ev {
                Event::Start(Tag::Item) => self.item(r, ordered, out, depth),
                Event::End(_) => return,
                _ => {}
            }
        }
    }

    #[allow(unused_assignments)]
    fn item(&mut self, r: StdRange<usize>, ordered: bool, out: &mut Vec<Block>, depth: usize) {
        let range = self.ctx.range(&r);
        let marker: String = self.ctx.src[r.start..].split_whitespace().next().unwrap_or("-").to_string();
        // Obsidian's custom task statuses (`- [/] doing`): pulldown-cmark knows only `[ ]` and `[x]`,
        // so any other single character is read here, as the reading view does (toimprove 235).
        let skip = custom_status_end(&self.ctx.src[r.start..r.end], marker.len()).map(|n| r.start + n);
        let mut task = if skip.is_some() { TaskState::Done } else { TaskState::None };
        let skip = skip.unwrap_or(0);
        let mut inl = Inl::new();
        let mut emitted = false;
        let mut started = false;
        macro_rules! emit {
            () => {
                if !emitted {
                    emitted = true;
                    let fin = std::mem::take(&mut inl).finish(&mut self.ctx);
                    let starts_with_text = matches!(fin.pieces.first(), Some(Piece::Text { .. }));
                    let item = |text: String, inline: Vec<Inline>, marks: Vec<Mark>| BlockKind::ListItem { ordered, marker: marker.clone(), depth, task, text, inline, marks };
                    if starts_with_text {
                        // Text after an embed continues the item, without a second marker.
                        out.extend(fin.into_blocks(range, |text, inline, marks, first| {
                            if first { item(text, inline, marks) } else { BlockKind::Paragraph { text, inline, marks } }
                        }));
                    } else {
                        // An item that starts with an embed (or is empty) keeps its marker as an empty item.
                        let block_id = if fin.pieces.is_empty() { fin.block_id.clone() } else { None };
                        out.push(Block { range, kind: item(String::new(), Vec::new(), Vec::new()), block_id });
                        out.extend(fin.into_blocks(range, |text, inline, marks, _| BlockKind::Paragraph { text, inline, marks }));
                    }
                }
            };
        }
        while let Some((ev, er)) = self.next() {
            match ev {
                Event::End(TagEnd::Item) => break,
                Event::TaskListMarker(done) => task = if done { TaskState::Done } else { TaskState::Open },
                Event::Start(Tag::Paragraph) if !emitted && !started => {
                    started = true;
                    while let Some((ev, r2)) = self.next() {
                        if matches!(ev, Event::End(TagEnd::Paragraph)) {
                            break;
                        }
                        if let Some((ev, r2)) = after_status(ev, r2, skip) {
                            inl.feed(&mut self.ctx, ev, &r2);
                        }
                    }
                }
                Event::Start(Tag::List(first)) => {
                    emit!();
                    self.list(first.is_some(), out, depth + 1);
                }
                Event::Start(t @ (Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. } | Tag::Image { .. } | Tag::Superscript | Tag::Subscript))
                    if !emitted =>
                {
                    started = true;
                    inl.feed(&mut self.ctx, Event::Start(t), &er);
                }
                Event::Start(t) => {
                    emit!();
                    self.block(Event::Start(t), er, out, depth);
                }
                ev @ (Event::Text(_)
                | Event::Code(_)
                | Event::InlineMath(_)
                | Event::DisplayMath(_)
                | Event::InlineHtml(_)
                | Event::Html(_)
                | Event::FootnoteReference(_)
                | Event::SoftBreak
                | Event::HardBreak
                | Event::End(_)) => {
                    started = true;
                    if let Some((ev, er)) = after_status(ev, er, skip) {
                        inl.feed(&mut self.ctx, ev, &er);
                    }
                }
                ev => self.block(ev, er, out, depth),
            }
        }
        emit!();
    }

    fn table(&mut self, range: Range, aligns: Vec<Alignment>, out: &mut Vec<Block>) {
        let align: Vec<Align> = aligns
            .iter()
            .map(|a| match a {
                Alignment::None => Align::None,
                Alignment::Left => Align::Left,
                Alignment::Center => Align::Center,
                Alignment::Right => Align::Right,
            })
            .collect();
        let mut header: Vec<String> = Vec::new();
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut header_marks: Vec<Vec<Mark>> = Vec::new();
        let mut row_marks: Vec<Vec<Vec<Mark>>> = Vec::new();
        let mut hoisted: Vec<Block> = Vec::new();
        let mut in_head = false;
        while let Some((ev, _)) = self.next() {
            match ev {
                Event::Start(Tag::TableHead) => in_head = true,
                Event::End(TagEnd::TableHead) => in_head = false,
                Event::Start(Tag::TableRow) => {
                    rows.push(Vec::new());
                    row_marks.push(Vec::new());
                }
                Event::Start(Tag::TableCell) => {
                    let fin = self.inline_run(|e| matches!(e, TagEnd::TableCell));
                    let (text, marks, blocks) = fin.flat();
                    hoisted.extend(blocks);
                    if in_head {
                        header.push(text);
                        header_marks.push(marks);
                    } else if let Some(row) = rows.last_mut() {
                        row.push(text);
                        if let Some(r) = row_marks.last_mut() {
                            r.push(marks);
                        }
                    }
                }
                Event::End(TagEnd::Table) => break,
                _ => {}
            }
        }
        let cols = align.len().max(header.len());
        let cell_count = header.len() + rows.iter().map(Vec::len).sum::<usize>();
        out.push(Block { range, kind: BlockKind::Table { align, header, rows, cols, cell_count, header_marks, row_marks }, block_id: None });
        out.extend(hoisted);
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// `> [!type]+ Title` on the first line of a blockquote: (type, fold state, raw title).
fn callout_head(src_from_quote: &str) -> Option<(String, FoldState, String)> {
    let line = src_from_quote.lines().next()?.trim_start();
    let rest = line.strip_prefix('>')?.trim_start().strip_prefix("[!")?;
    let (ty, after) = rest.split_once(']')?;
    if ty.is_empty() || !ty.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return None;
    }
    let (fold, title) = match after.as_bytes().first() {
        Some(b'+') => (FoldState::Open, &after[1..]),
        Some(b'-') => (FoldState::Closed, &after[1..]),
        _ => (FoldState::None, after),
    };
    Some((ty.to_ascii_lowercase(), fold, title.trim().to_string()))
}

/// In a list item's source (`marker` bytes long), the end of an Obsidian custom task status such
/// as `[/] ` (any one character but a space or x, then a space), or None.
fn custom_status_end(item: &str, marker: usize) -> Option<usize> {
    let rest = item.get(marker..)?;
    let ws = rest.len() - rest.trim_start_matches([' ', '\t']).len();
    if ws == 0 {
        return None;
    }
    let mut chars = rest[ws..].char_indices();
    let (_, open) = chars.next()?;
    let (_, mark) = chars.next()?;
    let (close_at, close) = chars.next()?;
    let (gap_at, gap) = chars.next()?;
    if open != '[' || close != ']' || !matches!(gap, ' ' | '\t') || matches!(mark, ' ' | 'x' | 'X' | ']' | '[' | '\\' | '\n') {
        return None;
    }
    let _ = close_at;
    let after = &rest[ws + gap_at..];
    let spaces = after.len() - after.trim_start_matches([' ', '\t']).len();
    Some(marker + ws + gap_at + spaces)
}

/// `ev` without the part before `skip` (a custom task status); None when it lies wholly before.
fn after_status<'b>(ev: Event<'b>, r: StdRange<usize>, skip: usize) -> Option<(Event<'b>, StdRange<usize>)> {
    if skip <= r.start {
        return Some((ev, r));
    }
    match ev {
        Event::Text(t) if r.end <= skip => {
            let _ = t;
            None
        }
        Event::Text(t) if t.len() == r.end - r.start && t.is_char_boundary(skip - r.start) => {
            Some((Event::Text(CowStr::from(t[skip - r.start..].to_string())), skip..r.end))
        }
        ev => Some((ev, r)),
    }
}
