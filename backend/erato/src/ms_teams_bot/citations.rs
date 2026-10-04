//! Native Teams citations for Erato file links. Source metadata is supplied
//! by Host; assistant-written URLs alone never establish a source.

use super::render::{self, Mention};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ops::Range;
use std::sync::LazyLock;
use url::Url;

const MAX_CITATIONS: usize = 20;
const MAX_ACTIVITY_BYTES: usize = 24_000;
static FILE_URI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"erato-file://[^\s<>()\[\]`]+").unwrap());
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[(\d+)\]").unwrap());

#[derive(Debug, Clone)]
pub struct FileSource {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Citation {
    position: usize,
    appearance: Value,
}

#[derive(Clone)]
struct Reference {
    range: Range<usize>,
    uri: String,
    label: String,
}

fn file_url(uri: &str) -> Option<Url> {
    let url = Url::parse(uri).ok()?;
    (url.scheme() == "erato-file"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path().is_empty()
        && url.query().is_none())
    .then_some(url)
}

/// Parse real Markdown links, including reference links, and bare file URIs.
/// Code examples and images must not turn into source claims.
fn references(text: &str) -> Vec<Reference> {
    let mut result = Vec::new();
    let mut link: Option<Reference> = None;
    let mut image = false;
    let mut code = false;
    let mut definition: Option<(String, Range<usize>, usize)> = None;
    let mut definitions = HashMap::new();
    let mut footnotes = Vec::new();
    let mut removed = Vec::new();
    let parser = Parser::new_ext(text, Options::ENABLE_FOOTNOTES);
    let link_definitions: Vec<_> = parser
        .reference_definitions()
        .iter()
        .filter(|(_, definition)| file_url(&definition.dest).is_some())
        .map(|(_, definition)| definition.span.clone())
        .collect();
    let mut image_destinations = HashSet::new();
    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code = true,
            Event::End(TagEnd::CodeBlock) => code = false,
            Event::Start(Tag::Image { dest_url, .. }) => {
                image = true;
                image_destinations.insert(dest_url.into_string());
            }
            Event::End(TagEnd::Image) => image = false,
            Event::Start(Tag::Link { dest_url, .. }) if !image => {
                link = Some(Reference {
                    range,
                    uri: dest_url.into_string(),
                    label: String::new(),
                });
            }
            Event::End(TagEnd::Link) => {
                if let Some(reference) = link.take()
                    && file_url(&reference.uri).is_some()
                {
                    result.push(reference);
                }
            }
            Event::Text(value) | Event::Code(value) if link.is_some() && !image => {
                link.as_mut().unwrap().label.push_str(&value);
            }
            Event::Text(_) if !code && !image => {
                for found in FILE_URI.find_iter(&text[range.clone()]) {
                    let uri = found
                        .as_str()
                        .trim_end_matches(['.', ',', ';', ':', '!', '?']);
                    if file_url(uri).is_some() {
                        result.push(Reference {
                            range: range.start + found.start()
                                ..range.start + found.start() + uri.len(),
                            uri: uri.into(),
                            label: String::new(),
                        });
                    }
                }
            }
            Event::Start(Tag::FootnoteDefinition(label)) => {
                definition = Some((label.into_string(), range, result.len()));
            }
            Event::End(TagEnd::FootnoteDefinition) => {
                if let Some((label, range, start)) = definition.take()
                    && result.len() == start + 1
                {
                    let reference = &result[start];
                    // Collapse only a file-only definition, retaining prose in
                    // more elaborate footnotes instead of silently deleting it.
                    let body = text[range.clone()]
                        .split_once(":")
                        .map(|(_, body)| body.trim());
                    if body == Some(text[reference.range.clone()].trim()) {
                        definitions.insert(label, reference.clone());
                        removed.push(range);
                        result.pop();
                    }
                }
            }
            Event::FootnoteReference(label) => footnotes.push((label.into_string(), range)),
            _ => {}
        }
    }
    // Converted reference-style links no longer need their hidden definition.
    // Keep definitions also used by an image, which this feature does not alter.
    for range in link_definitions {
        if !image_destinations
            .iter()
            .any(|uri| text[range.clone()].contains(uri))
        {
            removed.push(range);
        }
    }
    for (label, range) in footnotes {
        if let Some(reference) = definitions.get(&label) {
            result.push(Reference {
                range,
                label: String::new(),
                ..reference.clone()
            });
        }
    }
    // Empty references remove resolved file-only footnote definitions.
    result.extend(removed.into_iter().map(|range| Reference {
        range,
        uri: String::new(),
        label: String::new(),
    }));
    result.sort_by_key(|reference| reference.range.start);
    result
}

pub fn referenced_file_ids(text: &str) -> HashSet<String> {
    references(text)
        .iter()
        .filter_map(|reference| file_url(&reference.uri)?.host_str().map(str::to_string))
        .collect()
}

/// Convert only known file references. Unknown IDs stay readable without a
/// broken link or made-up citation. General MCP provenance is a separate feature.
pub fn render(
    text: &str,
    sources: &[FileSource],
    public_base_url: Option<&str>,
) -> (String, Vec<Citation>) {
    render_with_limit(text, sources, public_base_url, MAX_CITATIONS)
}

pub fn details(text: &str, sources: &[FileSource], public_base_url: Option<&str>) -> String {
    render_with_limit(text, sources, public_base_url, 0).0
}

fn render_with_limit(
    text: &str,
    sources: &[FileSource],
    public_base_url: Option<&str>,
    limit: usize,
) -> (String, Vec<Citation>) {
    let references = references(text);
    let files: HashMap<_, _> = sources
        .iter()
        .map(|source| (source.id.as_str(), source))
        .collect();
    let reserved: HashSet<usize> = NUMBER
        .captures_iter(text)
        .filter_map(|capture| {
            let range = capture.get(0).unwrap().range();
            (!references.iter().any(|reference| {
                reference.range.start <= range.start && reference.range.end >= range.end
            }))
            .then(|| capture[1].parse().ok())
            .flatten()
        })
        .collect();
    let mut positions = HashMap::new();
    let mut citations = Vec::new();
    let mut output = String::new();
    let mut cursor = 0;
    let mut next_position = 1;
    for reference in references {
        if reference.range.start < cursor {
            continue;
        }
        output.push_str(&text[cursor..reference.range.start]);
        cursor = reference.range.end;
        if reference.uri.is_empty() {
            continue;
        }
        let url = file_url(&reference.uri).unwrap();
        let Some(file) = files.get(url.host_str().unwrap().to_ascii_lowercase().as_str()) else {
            output.push_str(&escape_label(if reference.label.is_empty() {
                "Unavailable file"
            } else {
                &reference.label
            }));
            continue;
        };
        let location = location(&url, &file.name);
        let key = (file.id.clone(), location.clone());
        let source_url = source_url(public_base_url, &file.id, location.as_deref());
        let label =
            if reference.label.is_empty() || reference.label.chars().all(|c| c.is_ascii_digit()) {
                String::new()
            } else {
                escape_label(&reference.label)
            };
        let position = positions.get(&key).copied().or_else(|| {
            if citations.len() >= limit {
                return None;
            }
            while reserved.contains(&next_position) {
                next_position += 1;
            }
            let position = next_position;
            next_position += 1;
            positions.insert(key, position);
            let mut appearance =
                json!({"@type": "DigitalDocument", "name": short_name(&file.name)});
            if let Some(url) = &source_url {
                appearance["url"] = json!(url);
            }
            if let Some(location) = &location {
                let (kind, value) = location.split_once('=').unwrap();
                appearance["abstract"] = json!(format!(
                    "{} {value}",
                    if kind == "page" { "Page" } else { "Message" }
                ));
            }
            citations.push(Citation {
                position,
                appearance,
            });
            Some(position)
        });
        if let Some(position) = position {
            if !label.is_empty() {
                output.push_str(&format!("{label} "));
            }
            output.push_str(&format!("[{position}]"));
        } else {
            // Teams rejects >20 citations. Keep additional sources as ordinary
            // authenticated links instead of dropping them or the whole answer.
            let label = if label.is_empty() {
                escape_label(&file.name)
            } else {
                label
            };
            match source_url {
                Some(url) => output.push_str(&format!("[{label}](<{url}>)")),
                None => output.push_str(&label),
            }
        }
    }
    output.push_str(&text[cursor..]);
    (output.trim().into(), citations)
}

fn location(url: &Url, filename: &str) -> Option<String> {
    let filename = filename.to_ascii_lowercase();
    let key = if filename.ends_with(".pdf") {
        "page"
    } else if filename.ends_with(".md") {
        "msg"
    } else {
        return None;
    };
    let (name, value) = url.fragment()?.split_once('=')?;
    let value: u32 = value.parse().ok()?;
    (name == key && value > 0).then(|| format!("{key}={value}"))
}

fn source_url(base: Option<&str>, id: &str, location: Option<&str>) -> Option<String> {
    let mut url = Url::parse(base?).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_path(&format!(
        "{}/api/v1beta/files/{id}/preview",
        url.path().trim_end_matches('/')
    ));
    url.set_query(None);
    // The existing HTTP preview serves a file directly: browser PDF viewers
    // honor #page, but raw Markdown has no #msg navigation. Keep the message
    // locator in the citation's abstract without advertising a broken jump.
    url.set_fragment(location.filter(|location| location.starts_with("page=")));
    let url: String = url.into();
    (url.len() <= 2_048).then_some(url)
}

fn escape_label(label: &str) -> String {
    let mut escaped = String::new();
    for c in label.chars() {
        if "\\[]*_`<>".contains(c) {
            escaped.push('\\');
        }
        if !c.is_control() {
            escaped.push(c);
        }
    }
    escaped
}

fn short_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !c.is_control()).collect();
    if clean.is_empty() {
        return "File".into();
    }
    if clean.chars().count() <= 80 {
        clean
    } else {
        format!("{}…", clean.chars().take(79).collect::<String>())
    }
}

/// Merge with mentions and streaminfo; Teams permits exactly one Message entity.
pub fn attach(activity: &mut Value, citations: &[Citation]) {
    let text = activity["text"].as_str().unwrap_or_default();
    let claims: Vec<_> = citations.iter().filter(|citation| text.contains(&format!("[{}]", citation.position)))
        .map(|citation| json!({"@type": "Claim", "position": citation.position, "appearance": citation.appearance})).collect();
    if claims.is_empty() {
        return;
    }
    let entities = activity
        .as_object_mut()
        .unwrap()
        .entry("entities")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .unwrap();
    entities.push(json!({"type": "https://schema.org/Message", "@type": "Message", "@context": "https://schema.org", "citation": claims}));
}

/// Include citation metadata, UTF-8 and JSON escaping in the activity budget.
pub fn split(text: &str, citations: &[Citation], mention: Option<&Mention>) -> Vec<String> {
    let mut pending = VecDeque::from([text.trim().to_string()]);
    let mut chunks = Vec::new();
    while let Some(chunk) = pending.pop_front() {
        let mut activity = render::message(&chunk, mention);
        attach(&mut activity, citations);
        if (serde_json::to_vec(&activity).unwrap().len() <= MAX_ACTIVITY_BYTES
            && chunk.chars().count() <= render::MAX_MESSAGE_CHARS)
            || chunk.chars().count() < 2
        {
            chunks.push(chunk);
            continue;
        }
        let mut cut = chunk
            .char_indices()
            .nth(chunk.chars().count() / 2)
            .unwrap()
            .0;
        if let Some(boundary) = chunk[..cut]
            .rfind('\n')
            .filter(|boundary| *boundary > cut / 2)
        {
            cut = boundary;
        }
        // Never bisect a native citation marker.
        if let Some(marker) = NUMBER.find_iter(&chunk).find(|marker| {
            marker.start() < cut
                && marker.end() > cut
                && citations
                    .iter()
                    .any(|citation| marker.as_str() == format!("[{}]", citation.position))
        }) {
            if marker.end() < chunk.len() {
                cut = marker.end();
            } else if marker.start() > 0 {
                cut = marker.start();
            }
        }
        pending.push_front(chunk[cut..].trim_start().into());
        pending.push_front(chunk[..cut].trim_end().into());
    }
    chunks
}

#[cfg(test)]
mod tests;
