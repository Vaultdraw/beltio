//! The `NoteDoc` contract: what `parse_markdown` returns. JSON is camelCase; optional fields
//! are left out when empty. The TypeScript mirror (documented field by field) is `sdk/api/src/markdown.ts`.

use serde::Serialize;
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u32 = 1;

/// Byte range `[start, end]` in the source text handed to the parser.
pub type Range = [usize; 2];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDoc {
    pub schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter: Option<Frontmatter>,
    /// Top-level blocks in document order (containers hold their children).
    pub blocks: Vec<Block>,
    /// Every wikilink, embed and Markdown link, with its source range.
    pub links: Vec<DocLink>,
    /// Frontmatter tags then inline `#tags`, without `#`, first spelling kept, never from code.
    pub tags: Vec<String>,
    pub stats: Stats,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frontmatter {
    /// Byte range of the whole block including the `---` fences.
    pub range: Range,
    /// The YAML between the fences, `\r` removed.
    pub raw: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    /// Every top-level key as a string (lists joined with ", ").
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub words: usize,
    pub blocks: usize,
    /// Bold, italic, strikethrough and highlight spans whose markers were removed.
    pub dropped_emphasis: usize,
    /// HTML comments removed.
    pub dropped_html: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub range: Range,
    #[serde(flatten)]
    pub kind: BlockKind,
    /// `^block-id` that ended the block (or stood alone on the line after it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    None,
    Open,
    Done,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FoldState {
    None,
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BlockKind {
    Heading {
        level: u8,
        text: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        inline: Vec<Inline>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        marks: Vec<Mark>,
    },
    Paragraph {
        text: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        inline: Vec<Inline>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        marks: Vec<Mark>,
    },
    ListItem {
        ordered: bool,
        /// Marker as written: `-`, `*`, `+`, `1.`, `2)`.
        marker: String,
        /// 0 for the outermost list.
        depth: usize,
        task: TaskState,
        text: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        inline: Vec<Inline>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        marks: Vec<Mark>,
    },
    Code {
        /// Always true: lets a consumer test for code without matching the kind name.
        code: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        lang: Option<String>,
        text: String,
    },
    Blockquote {
        blocks: Vec<Block>,
    },
    Callout {
        callout_type: String,
        title: String,
        fold_state: FoldState,
        blocks: Vec<Block>,
    },
    ThematicBreak,
    Table {
        align: Vec<Align>,
        header: Vec<String>,
        rows: Vec<Vec<String>>,
        /// Number of columns.
        cols: usize,
        /// Header cells plus body cells.
        cell_count: usize,
        /// Bold, italic and code spans of each header cell (offsets into that cell's text).
        #[serde(skip_serializing_if = "no_marks")]
        header_marks: Vec<Vec<Mark>>,
        /// Same for the body cells, row by row.
        #[serde(skip_serializing_if = "no_row_marks")]
        row_marks: Vec<Vec<Vec<Mark>>>,
    },
    Image {
        target: String,
        /// True for `http(s):` and `data:` targets (never fetched).
        remote: bool,
        #[serde(skip_serializing_if = "String::is_empty")]
        alt: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        width: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        height: Option<u32>,
    },
    /// `![[Note]]`, `![[Note#Heading]]`, `![[doc.pdf#page=3]]`: an embed that is not an image.
    Embed {
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        heading: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        block_ref: Option<String>,
        #[serde(skip_serializing_if = "String::is_empty")]
        alt: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        width: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        height: Option<u32>,
    },
    /// Display math `$$ ... $$`.
    Math {
        latex: String,
    },
    FootnoteDef {
        label: String,
        blocks: Vec<Block>,
    },
    /// Raw HTML block: comments dropped, `<br>` as a newline, the rest as written.
    Html {
        text: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InlineKind {
    Wikilink,
    Link,
    Tag,
    Math,
    FootnoteRef,
}

/// What a style span is.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MarkKind {
    Bold,
    Italic,
    Code,
}

/// A bold, italic or code span inside a text (or table cell); offsets are UTF-16 code units. Spans
/// may nest (`***both***` is a bold and an italic span over the same range).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub kind: MarkKind,
    pub start: usize,
    pub end: usize,
}

fn no_marks(m: &[Vec<Mark>]) -> bool {
    m.iter().all(Vec::is_empty)
}

fn no_row_marks(m: &[Vec<Vec<Mark>>]) -> bool {
    m.iter().all(|r| no_marks(r))
}

/// A marked span inside a text block's `text`; offsets are UTF-16 code units (JavaScript string
/// indexes).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inline {
    pub kind: InlineKind,
    pub start: usize,
    pub end: usize,
    /// Wikilink note, link URL, tag name, LaTeX or footnote label.
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocLinkKind {
    Wikilink,
    Embed,
    Link,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocLink {
    pub kind: DocLinkKind,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_ref: Option<String>,
    /// Byte range of the link in the source.
    pub range: Range,
}

#[derive(Debug, Clone, Default)]
pub struct ParseOptions {
    /// A soft line break inside a paragraph becomes `\n` instead of a space.
    pub soft_break_newline: bool,
}
