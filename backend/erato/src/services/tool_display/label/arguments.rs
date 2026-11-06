//! The readable view of a call's arguments: their structure and a way to show
//! each one, as paths into the stored input. Values stay in the input, so the
//! view holds nothing a reader could not already see there.

use super::pointer::escape;
use crate::models::message::{ToolArgumentKind, ToolArgumentNode};
use crate::services::display_text::MAX_DISPLAY_NAME_CHARS;
use serde_json::Value;

/// Nodes in one view; the rest are counted as omitted.
pub const MAX_VIEW_NODES: usize = 250;
/// Bytes of all paths in one view: each path repeats its parents' keys, so
/// the node cap alone lets long keys grow the view far past its input.
pub const MAX_VIEW_PATH_BYTES: usize = 16 * 1024;
pub const MAX_VIEW_DEPTH: usize = 8;
pub const MAX_GROUP_MEMBERS: usize = 50;
pub const MAX_LIST_ENTRIES: usize = 25;
/// Longer strings, or any with a line break, show as a block of text.
pub const MAX_INLINE_CHARS: usize = 80;
const MAX_ID_CHARS: usize = 128;

/// The view of `arguments`, and whether the caps left any of them out.
pub fn readable_arguments(arguments: &Value) -> (ToolArgumentNode, bool) {
    let mut view = View {
        budget: MAX_VIEW_NODES,
        path_bytes: MAX_VIEW_PATH_BYTES,
        truncated: false,
    };
    let root = view.node(arguments, String::new(), None, 0);
    (root, view.truncated)
}

struct View {
    budget: usize,
    path_bytes: usize,
    truncated: bool,
}

impl View {
    /// `key` is the member name the value sits under; list entries inherit
    /// their list's, so the entries of `page_ids` read as IDs.
    fn node(
        &mut self,
        value: &Value,
        path: String,
        key: Option<&str>,
        depth: usize,
    ) -> ToolArgumentNode {
        self.budget = self.budget.saturating_sub(1);
        let mut node = ToolArgumentNode {
            path,
            kind: kind_of(value, key),
            children: Vec::new(),
            omitted: 0,
        };
        match value {
            Value::Object(members) => {
                let shown = self.shown(members.len(), MAX_GROUP_MEMBERS, depth);
                // A name too long to show is left out, so it cannot crowd out the rest.
                let nameable = members
                    .iter()
                    .filter(|(name, _)| name.chars().nth(MAX_DISPLAY_NAME_CHARS).is_none());
                for (name, member) in nameable.take(shown) {
                    let path = format!("{}/{}", node.path, escape(name));
                    if !self.charge(&path) {
                        break;
                    }
                    node.children
                        .push(self.node(member, path, Some(name), depth + 1));
                    if self.budget == 0 {
                        break;
                    }
                }
                node.omitted = self.omitted(members.len(), node.children.len());
            }
            Value::Array(entries) => {
                let shown = self.shown(entries.len(), MAX_LIST_ENTRIES, depth);
                for (index, entry) in entries.iter().enumerate().take(shown) {
                    let path = format!("{}/{index}", node.path);
                    if !self.charge(&path) {
                        break;
                    }
                    node.children.push(self.node(entry, path, key, depth + 1));
                    if self.budget == 0 {
                        break;
                    }
                }
                node.omitted = self.omitted(entries.len(), node.children.len());
            }
            _ => {}
        }
        node
    }

    fn shown(&self, len: usize, cap: usize, depth: usize) -> usize {
        if depth >= MAX_VIEW_DEPTH {
            0
        } else {
            len.min(cap).min(self.budget)
        }
    }

    fn charge(&mut self, path: &str) -> bool {
        let Some(left) = self.path_bytes.checked_sub(path.len()) else {
            return false;
        };
        self.path_bytes = left;
        true
    }

    fn omitted(&mut self, len: usize, shown: usize) -> u32 {
        let omitted = len - shown;
        self.truncated |= omitted > 0;
        u32::try_from(omitted).unwrap_or(u32::MAX)
    }
}

fn kind_of(value: &Value, key: Option<&str>) -> ToolArgumentKind {
    match value {
        Value::Object(_) => ToolArgumentKind::Group,
        Value::Array(_) => ToolArgumentKind::List,
        Value::String(text) if is_id_text(text, key) => ToolArgumentKind::Id,
        Value::String(text)
            if text.contains('\n') || text.chars().nth(MAX_INLINE_CHARS).is_some() =>
        {
            ToolArgumentKind::Text
        }
        Value::Number(number) if number.is_u64() && key.is_some_and(names_an_id) => {
            ToolArgumentKind::Id
        }
        _ => ToolArgumentKind::Value,
    }
}

fn is_id_text(text: &str, key: Option<&str>) -> bool {
    let token =
        !text.is_empty() && text.len() <= MAX_ID_CHARS && !text.chars().any(char::is_whitespace);
    token && (key.is_some_and(names_an_id) || looks_like_a_uuid(text))
}

/// `id`, `page_id`, `recordId`, `page_ids`, `uuid`; not `valid` or `paid`.
fn names_an_id(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    if matches!(lower.as_str(), "id" | "ids") || lower.ends_with("uuid") || lower.ends_with("guid")
    {
        return true;
    }
    if ["_id", "-id", "_ids", "-ids"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return true;
    }
    ["Id", "ID", "Ids", "IDs"].iter().any(|suffix| {
        key.strip_suffix(suffix)
            .and_then(|stem| stem.chars().last())
            .is_some_and(|last| last.is_ascii_lowercase() || last.is_ascii_digit())
    })
}

/// A GUID with or without hyphens and braces, as Dataverse and Notion write them.
fn looks_like_a_uuid(text: &str) -> bool {
    let bare = text
        .strip_prefix('{')
        .and_then(|inner| inner.strip_suffix('}'))
        .unwrap_or(text);
    let hex = bare.bytes().filter(u8::is_ascii_hexdigit).count();
    let hyphenated = bare.len() == 36
        && bare.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    hyphenated || (bare.len() == 32 && hex == 32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn kinds(node: &ToolArgumentNode) -> Vec<(String, ToolArgumentKind)> {
        let mut out = vec![(node.path.clone(), node.kind)];
        for child in &node.children {
            out.extend(kinds(child));
        }
        out
    }

    #[test]
    fn text_lists_and_ids_are_told_apart_by_shape_and_name() {
        let arguments = json!({
            "parent": {"data_source_id": "src_42"},
            "pages": [{
                "properties": {"Name": "Acme", "Seats": 12, "Active": true},
                "content": "# Notes\n\nFirst meeting went well.",
            }],
            "page_ids": ["p1", "p2"],
            "recordId": "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b",
            "valid": "yes",
            "note": "x".repeat(MAX_INLINE_CHARS + 1),
            "ref": "9b1d5f2e3c4a4f88a1b20c1d2e3f4a5b",
            "thread_id": "has spaces so not an id",
            "ticket_id": 77,
            "nothing": null,
        });
        let (view, truncated) = readable_arguments(&arguments);
        assert!(!truncated);
        use ToolArgumentKind::*;
        assert_eq!(
            kinds(&view),
            [
                ("", Group),
                ("/parent", Group),
                ("/parent/data_source_id", Id),
                ("/pages", List),
                ("/pages/0", Group),
                ("/pages/0/properties", Group),
                ("/pages/0/properties/Name", Value),
                ("/pages/0/properties/Seats", Value),
                ("/pages/0/properties/Active", Value),
                ("/pages/0/content", Text),
                ("/page_ids", List),
                ("/page_ids/0", Id),
                ("/page_ids/1", Id),
                ("/recordId", Id),
                ("/valid", Value),
                ("/note", Text),
                ("/ref", Id),
                ("/thread_id", Value),
                ("/ticket_id", Id),
                ("/nothing", Value),
            ]
            .map(|(path, kind)| (path.to_string(), kind))
        );
    }

    #[test]
    fn caps_count_what_they_leave_out() {
        let entries: Vec<_> = (0..MAX_LIST_ENTRIES + 5).map(|i| json!(i)).collect();
        let (view, truncated) = readable_arguments(&json!({"rows": entries}));
        assert!(truncated);
        assert_eq!(view.children[0].children.len(), MAX_LIST_ENTRIES);
        assert_eq!(view.children[0].omitted, 5);

        let mut deep = json!("leaf");
        for _ in 0..MAX_VIEW_DEPTH + 2 {
            deep = json!({ "next": deep });
        }
        let (view, truncated) = readable_arguments(&deep);
        assert!(truncated);
        let mut node = &view;
        let mut depth = 0;
        while let Some(child) = node.children.first() {
            node = child;
            depth += 1;
        }
        assert_eq!(depth, MAX_VIEW_DEPTH);
        assert_eq!((node.kind, node.omitted), (ToolArgumentKind::Group, 1));

        let wide: serde_json::Map<_, _> = (0..20)
            .map(|i| {
                let row: Vec<_> = (0..20).map(|j| json!(j)).collect();
                (format!("k{i:02}"), json!(row))
            })
            .collect();
        let (view, truncated) = readable_arguments(&Value::Object(wide));
        assert!(truncated);
        assert_eq!(kinds(&view).len(), MAX_VIEW_NODES);
        assert_eq!(view.children.len() + view.omitted as usize, 20);
        let last = view.children.last().unwrap();
        assert_eq!(last.children.len() + last.omitted as usize, 20);
        assert!(last.omitted > 0);
    }

    fn path_bytes(node: &ToolArgumentNode) -> usize {
        node.path.len() + node.children.iter().map(path_bytes).sum::<usize>()
    }

    #[test]
    fn long_keys_are_left_out_and_all_paths_share_one_budget() {
        let mut members = serde_json::Map::new();
        members.insert("k".repeat(MAX_DISPLAY_NAME_CHARS + 1), json!(1));
        members.insert("query".into(), json!("q"));
        let (view, truncated) = readable_arguments(&Value::Object(members));
        assert!(truncated);
        assert_eq!(view.omitted, 1);
        assert_eq!(
            kinds(&view)[1..],
            [("/query".to_string(), ToolArgumentKind::Value)]
        );

        let key = "k".repeat(MAX_DISPLAY_NAME_CHARS - 1);
        let mut nested = json!("leaf");
        for _ in 0..MAX_VIEW_DEPTH {
            nested = Value::Object(
                ["a", "b"]
                    .iter()
                    .map(|side| (format!("{side}{key}"), nested.clone()))
                    .collect(),
            );
        }
        let (view, truncated) = readable_arguments(&nested);
        assert!(truncated);
        assert!(path_bytes(&view) <= MAX_VIEW_PATH_BYTES);
        assert!(kinds(&view).len() < MAX_VIEW_NODES);
    }

    #[test]
    fn keys_are_escaped_and_scalars_make_a_single_node() {
        let (view, _) = readable_arguments(&json!({"a/b": {"c~d": 1}}));
        assert_eq!(view.children[0].children[0].path, "/a~1b/c~0d");
        let (view, truncated) = readable_arguments(&json!("not an object"));
        assert_eq!(
            (view.path.as_str(), view.kind, truncated),
            ("", ToolArgumentKind::Value, false)
        );
    }

    #[test]
    fn id_names_need_a_word_boundary() {
        for key in [
            "id", "ID", "ids", "page_id", "page-id", "page_ids", "recordId", "pageID", "pageIds",
            "uuid", "row2Id", "Guid",
        ] {
            assert!(names_an_id(key), "{key}");
        }
        for key in ["valid", "paid", "Android", "UUIDs_list", "Id_card", "I"] {
            assert!(!names_an_id(key), "{key}");
        }
    }
}
