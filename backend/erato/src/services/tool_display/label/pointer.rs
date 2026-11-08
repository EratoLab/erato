//! JSON pointers (RFC 6901) with `*` for every element of an array or every
//! member of an object, so one pointer covers a batch of any size. A literal
//! `*` key cannot be addressed.

use serde_json::Value;
use std::borrow::Cow;
use std::ops::ControlFlow;

/// A longer pointer reaches nothing: no label part needs one, and pointers
/// from a model or a cache are not trusted to be small.
pub const MAX_POINTER_BYTES: usize = 512;
pub const MAX_POINTER_TOKENS: usize = 32;
/// A value whose concrete path is longer still counts as reached, but its
/// path is not handed out: keys can be any length.
pub const MAX_PATH_BYTES: usize = 1024;
/// Values [`resolve`] returns at most.
pub const MAX_REACHED: usize = 256;

/// A value a pointer reached, with its concrete path.
#[derive(Debug, Clone, PartialEq)]
pub struct Reached<'a> {
    pub path: String,
    pub value: &'a Value,
}

/// The first [`MAX_REACHED`] values `pointer` reaches in `document`, in
/// document order, leaving out those whose path is too long. Empty when it
/// reaches nothing or is not a pointer; the empty pointer counts as not one,
/// since no label part names the whole input.
pub fn resolve<'a>(document: &'a Value, pointer: &str) -> Vec<Reached<'a>> {
    let mut reached = Vec::new();
    visit(document, pointer, |path, value| {
        if let Some(path) = path {
            reached.push(Reached {
                path: path.to_string(),
                value,
            });
        }
        if reached.len() == MAX_REACHED {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    });
    reached
}

/// Calls `each` with every value `pointer` reaches, in document order, and
/// its concrete path, or `None` for a path over [`MAX_PATH_BYTES`]; returns
/// how many it reached before `each` broke off. Each part of `document` is
/// walked at most once and paths are built only for reached values, so a
/// wildcard over a huge batch costs time in its size but no memory.
pub fn visit<'a>(
    document: &'a Value,
    pointer: &str,
    each: impl FnMut(Option<&str>, &'a Value) -> ControlFlow<()>,
) -> usize {
    let Some(tokens) = tokens(pointer) else {
        return 0;
    };
    let mut walk = Walk {
        tokens: &tokens,
        path: String::new(),
        reached: 0,
        each,
    };
    let _ = walk.step(document, 0, true);
    walk.reached
}

/// Each token raw, as it goes into a concrete path, and unescaped.
fn tokens(pointer: &str) -> Option<Vec<(&str, Cow<'_, str>)>> {
    if pointer.len() > MAX_POINTER_BYTES {
        return None;
    }
    let tokens: Vec<_> = pointer
        .strip_prefix('/')?
        .split('/')
        .map(|raw| (raw, unescape(raw)))
        .collect();
    (tokens.len() <= MAX_POINTER_TOKENS).then_some(tokens)
}

struct Walk<'t, F> {
    tokens: &'t [(&'t str, Cow<'t, str>)],
    path: String,
    reached: usize,
    each: F,
}

enum Segment<'s> {
    Index(usize),
    Key(&'s str),
    Raw(&'s str),
}

impl<'a, F: FnMut(Option<&str>, &'a Value) -> ControlFlow<()>> Walk<'_, F> {
    fn step(&mut self, value: &'a Value, depth: usize, fits: bool) -> ControlFlow<()> {
        let Some((raw, token)) = self.tokens.get(depth) else {
            self.reached = self.reached.saturating_add(1);
            return (self.each)(fits.then_some(self.path.as_str()), value);
        };
        match value {
            Value::Array(items) if token == "*" => {
                for (index, item) in items.iter().enumerate() {
                    self.descend(item, depth, fits, Segment::Index(index))?;
                }
            }
            Value::Object(members) if token == "*" => {
                for (key, member) in members {
                    self.descend(member, depth, fits, Segment::Key(key))?;
                }
            }
            Value::Object(members) => {
                if let Some(member) = members.get(token.as_ref()) {
                    self.descend(member, depth, fits, Segment::Raw(raw))?;
                }
            }
            Value::Array(items) => {
                if let Some(item) = array_index(token).and_then(|index| items.get(index)) {
                    self.descend(item, depth, fits, Segment::Raw(raw))?;
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn descend(
        &mut self,
        value: &'a Value,
        depth: usize,
        fits: bool,
        segment: Segment<'_>,
    ) -> ControlFlow<()> {
        let len = self.path.len();
        let fits = fits && self.push(segment);
        let flow = self.step(value, depth + 1, fits);
        self.path.truncate(len);
        flow
    }

    /// Appends `segment` unless that would take the path over the cap.
    fn push(&mut self, segment: Segment<'_>) -> bool {
        use std::fmt::Write;
        let added = match segment {
            Segment::Index(index) => index.checked_ilog10().unwrap_or(0) as usize + 1,
            Segment::Key(key) => key.len() + key.matches(['~', '/']).count(),
            Segment::Raw(raw) => raw.len(),
        };
        if self.path.len().saturating_add(1).saturating_add(added) > MAX_PATH_BYTES {
            return false;
        }
        self.path.push('/');
        match segment {
            Segment::Index(index) => {
                let _ = write!(self.path, "{index}");
            }
            Segment::Key(key) => self.path.push_str(&escape(key)),
            Segment::Raw(raw) => self.path.push_str(raw),
        }
        true
    }
}

/// The last segment of `pointer` that names a member, unescaped: what a field
/// is called on the card.
pub fn last_name(pointer: &str) -> Option<Cow<'_, str>> {
    pointer
        .strip_prefix('/')?
        .rsplit('/')
        .find(|token| *token != "*" && array_index(token).is_none())
        .map(unescape)
}

pub fn escape(key: &str) -> Cow<'_, str> {
    if key.contains(['~', '/']) {
        Cow::Owned(key.replace('~', "~0").replace('/', "~1"))
    } else {
        Cow::Borrowed(key)
    }
}

fn unescape(token: &str) -> Cow<'_, str> {
    if token.contains('~') {
        Cow::Owned(token.replace("~1", "/").replace("~0", "~"))
    } else {
        Cow::Borrowed(token)
    }
}

/// `str::parse` alone would also take `+1`, and RFC 6901 has no leading zeros.
fn array_index(token: &str) -> Option<usize> {
    let canonical = token == "0" || !token.starts_with('0');
    if token.is_empty() || !canonical || !token.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    token.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paths(document: &Value, pointer: &str) -> Vec<String> {
        resolve(document, pointer)
            .into_iter()
            .map(|reached| reached.path)
            .collect()
    }

    #[test]
    fn wildcards_reach_every_element_with_its_concrete_path() {
        let arguments = json!({
            "pages": [
                {"properties": {"Name": "Acme"}},
                {"properties": {"Name": "Globex"}},
                {"content": "no name here"},
            ]
        });
        let reached = resolve(&arguments, "/pages/*/properties/Name");
        assert_eq!(
            reached,
            vec![
                Reached {
                    path: "/pages/0/properties/Name".into(),
                    value: &json!("Acme"),
                },
                Reached {
                    path: "/pages/1/properties/Name".into(),
                    value: &json!("Globex"),
                },
            ]
        );
        assert_eq!(paths(&arguments, "/pages/1/properties/Name").len(), 1);
        assert_eq!(
            paths(&json!({"a": {"x": 1, "y": 2}}), "/a/*"),
            vec!["/a/x", "/a/y"]
        );
    }

    #[test]
    fn escaped_keys_resolve_and_stay_escaped_in_paths() {
        let arguments = json!({"a/b": {"m~n": "v"}, "items": [{"c/d": 1}]});
        assert_eq!(paths(&arguments, "/a~1b/m~0n"), vec!["/a~1b/m~0n"]);
        assert_eq!(paths(&arguments, "/items/*/c~1d"), vec!["/items/0/c~1d"]);
        assert_eq!(paths(&json!({"x": {"a/b": 1}}), "/x/*"), vec!["/x/a~1b"]);
        assert!(resolve(&arguments, "/a/b/m~0n").is_empty());
    }

    #[test]
    fn misses_and_non_pointers_reach_nothing() {
        let arguments = json!({"title": "x", "list": [1, 2], "empty": []});
        for pointer in [
            "",
            "title",
            "/missing",
            "/title/deeper",
            "/list/2",
            "/list/+1",
            "/list/-",
            "/empty/*",
        ] {
            assert!(resolve(&arguments, pointer).is_empty(), "{pointer}");
        }
        assert_eq!(paths(&arguments, "/list/1"), vec!["/list/1"]);
        assert_eq!(
            resolve(&json!({"parent": null}), "/parent")[0].value,
            &Value::Null
        );
    }

    #[test]
    fn odd_keys_resolve_and_odd_pointers_reach_nothing() {
        let arguments = json!({
            "": {"": "empty keys"},
            "~": 1,
            "\u{202E}\u{200B}\u{0}": 2,
            "*": 3,
            "list": [10, 11],
        });
        assert_eq!(paths(&arguments, "/"), vec!["/"]);
        assert_eq!(paths(&arguments, "//"), vec!["//"]);
        assert_eq!(paths(&arguments, "/~0"), vec!["/~0"]);
        assert_eq!(
            paths(&arguments, "/\u{202E}\u{200B}\u{0}"),
            vec!["/\u{202E}\u{200B}\u{0}"]
        );
        assert_eq!(paths(&arguments, "/list/0"), vec!["/list/0"]);
        for pointer in ["/list/00", "/list/01", "/list/1e0", "/list/ 1", "/~2", "~1"] {
            assert!(resolve(&arguments, pointer).is_empty(), "{pointer}");
        }
        let long = format!("/{}", "a".repeat(MAX_POINTER_BYTES));
        let deep = "/*".repeat(MAX_POINTER_TOKENS + 1);
        let nested = (0..MAX_POINTER_TOKENS + 1).fold(json!("leaf"), |inner, _| json!([inner]));
        assert!(resolve(&json!({ &long[1..]: 1 }), &long).is_empty());
        assert!(resolve(&nested, &deep).is_empty());
        assert_eq!(resolve(&nested, &deep[2..]).len(), 1);
    }

    #[test]
    fn huge_batches_are_counted_but_only_short_paths_handed_out() {
        let rows: Vec<_> = (0..20_000).map(|i| json!({ "name": i })).collect();
        let arguments = json!({ "rows": rows });
        let mut seen = 0usize;
        let reached = visit(&arguments, "/rows/*/name", |path, _| {
            seen += usize::from(path.is_some());
            ControlFlow::Continue(())
        });
        assert_eq!((reached, seen), (20_000, 20_000));
        let kept = resolve(&arguments, "/rows/*/name");
        assert_eq!(kept.len(), MAX_REACHED);
        assert_eq!(
            kept.last().unwrap().path,
            format!("/rows/{}/name", MAX_REACHED - 1)
        );

        let long = "k/".repeat(MAX_PATH_BYTES / 2);
        let arguments = json!({ "a": { &long: "hidden", "short": "shown" } });
        let mut handed_out = Vec::new();
        let reached = visit(&arguments, "/a/*", |path, _| {
            handed_out.push(path.map(str::to_string));
            ControlFlow::Continue(())
        });
        assert_eq!(reached, 2);
        assert_eq!(handed_out, [None, Some("/a/short".to_string())]);
        assert_eq!(paths(&arguments, "/a/*"), vec!["/a/short"]);

        let mut wide = serde_json::Map::new();
        for i in 0..200 {
            wide.insert(format!("k{i}"), json!((0..200).collect::<Vec<_>>()));
        }
        let reached = visit(&Value::Object(wide), "/*/*", |_, _| ControlFlow::Break(()));
        assert_eq!(reached, 1);
    }

    #[test]
    fn a_field_is_named_after_its_last_member() {
        assert_eq!(last_name("/pages/*/properties/Name").unwrap(), "Name");
        assert_eq!(last_name("/to/*").unwrap(), "to");
        assert_eq!(last_name("/changes/0").unwrap(), "changes");
        assert_eq!(last_name("/a~1b").unwrap(), "a/b");
        assert_eq!(last_name("/*"), None);
        assert_eq!(last_name("name"), None);
    }
}
