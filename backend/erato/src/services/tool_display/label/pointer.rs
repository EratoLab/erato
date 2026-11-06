//! JSON pointers (RFC 6901) with `*` for every element of an array or every
//! member of an object, so one pointer covers a batch of any size. A literal
//! `*` key cannot be addressed.

use serde_json::Value;
use std::borrow::Cow;

/// A value a pointer reached, with its concrete path.
#[derive(Debug, Clone, PartialEq)]
pub struct Reached<'a> {
    pub path: String,
    pub value: &'a Value,
}

/// Every value `pointer` reaches in `document`, in document order. Empty when
/// it reaches nothing or is not a pointer; the empty pointer counts as not
/// one, since no label part names the whole input.
pub fn resolve<'a>(document: &'a Value, pointer: &str) -> Vec<Reached<'a>> {
    let Some(tokens) = pointer.strip_prefix('/') else {
        return Vec::new();
    };
    let mut frontier = vec![Reached {
        path: String::new(),
        value: document,
    }];
    for raw in tokens.split('/') {
        let token = unescape(raw);
        let mut next = Vec::new();
        for Reached { path, value } in frontier {
            match value {
                Value::Array(items) if token == "*" => {
                    next.extend(items.iter().enumerate().map(|(index, value)| Reached {
                        path: format!("{path}/{index}"),
                        value,
                    }));
                }
                Value::Object(members) if token == "*" => {
                    next.extend(members.iter().map(|(key, value)| Reached {
                        path: format!("{path}/{}", escape(key)),
                        value,
                    }));
                }
                Value::Object(members) => {
                    if let Some(value) = members.get(token.as_ref()) {
                        next.push(Reached {
                            path: format!("{path}/{raw}"),
                            value,
                        });
                    }
                }
                Value::Array(items) => {
                    if let Some(value) = array_index(&token).and_then(|index| items.get(index)) {
                        next.push(Reached {
                            path: format!("{path}/{raw}"),
                            value,
                        });
                    }
                }
                _ => {}
            }
        }
        if next.is_empty() {
            return next;
        }
        frontier = next;
    }
    frontier
}

/// The last segment of `pointer` that names a member, unescaped: what a field
/// is called on the card.
pub fn last_name(pointer: &str) -> Option<Cow<'_, str>> {
    member_names(pointer).pop()
}

/// The segments of `pointer` that name members, unescaped, in order.
pub fn member_names(pointer: &str) -> Vec<Cow<'_, str>> {
    pointer
        .strip_prefix('/')
        .map(|tokens| {
            tokens
                .split('/')
                .filter(|token| *token != "*" && array_index(token).is_none())
                .map(unescape)
                .collect()
        })
        .unwrap_or_default()
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

/// `str::parse` alone would also take `+1`.
fn array_index(token: &str) -> Option<usize> {
    if token.is_empty() || !token.bytes().all(|byte| byte.is_ascii_digit()) {
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
    fn a_field_is_named_after_its_last_member() {
        assert_eq!(last_name("/pages/*/properties/Name").unwrap(), "Name");
        assert_eq!(last_name("/to/*").unwrap(), "to");
        assert_eq!(last_name("/changes/0").unwrap(), "changes");
        assert_eq!(last_name("/a~1b").unwrap(), "a/b");
        assert_eq!(last_name("/*"), None);
        assert_eq!(last_name("name"), None);
        assert_eq!(
            member_names("/item/a~1b/*/recordId/0"),
            ["item", "a/b", "recordId"]
        );
    }
}
