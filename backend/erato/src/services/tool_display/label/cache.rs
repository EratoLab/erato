//! Model label mappings per user, tool and argument shape. Entries and keys
//! hold no argument value; `mcp_call_mapping` drops a mapping the
//! cross-check rejects, so no hook invalidates entries when a tool's
//! annotations change.

use super::pointer::escape;
use super::rules::verb_fields;
use super::{MAX_LABEL_ITEMS, ToolCallLabelItemMapping, ToolCallLabelMapping, resolve_label};
use crate::metrics::owned::Cached;
use crate::models::message::ToolCallLabelSource;
use moka::future::Cache;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::future::Future;
use std::time::Duration;

const MAX_BYTES: u64 = 16 * 1024 * 1024;
const TIME_TO_IDLE: Duration = Duration::from_hours(12);
const MEMORY_OWNER: &str = "app_state.tool_label_cache.values";
/// Values one shape walk visits and bytes of the paths it keeps; past either,
/// calls that differ only further on share a key, and the pointer check on
/// every hit still drops a mapping that does not fit.
const MAX_SHAPE_VALUES: usize = 5_000;
const MAX_SHAPE_PATH_BYTES: usize = 64 * 1024;
const MAX_SHAPE_DEPTH: usize = 16;

/// What one model mapping is kept under.
#[derive(Debug, Clone, PartialEq, Eq, Hash, erato_memory::HeapSize)]
pub struct ToolLabelCacheKey {
    user_id: String,
    server_id: String,
    tool_name: String,
    /// The tool's input schema, so a changed tool misses; a key reorder in
    /// it only costs a miss.
    schema: [u8; 32],
    /// The arguments' member paths, with array indices as `*` and the kind of
    /// value each holds, and their verb fields with their values.
    shape: [u8; 32],
}

impl ToolLabelCacheKey {
    /// `tool` is the one the call is gated with, since tool lists can differ
    /// per user.
    pub fn new(
        user_id: &str,
        server_id: &str,
        tool: &rmcp::model::Tool,
        arguments: &Value,
    ) -> Self {
        Self {
            user_id: user_id.to_string(),
            server_id: server_id.to_string(),
            tool_name: tool.name.to_string(),
            schema: Sha256::digest(serde_json::to_vec(&*tool.input_schema).unwrap_or_default())
                .into(),
            shape: shape_digest(arguments),
        }
    }
}

/// Per replica: a miss only costs another model run.
#[derive(Clone)]
pub struct ToolLabelCache {
    entries: Cache<ToolLabelCacheKey, Cached<ToolCallLabelMapping>>,
}

impl Default for ToolLabelCache {
    fn default() -> Self {
        Self {
            entries: Cache::builder()
                .weigher(weight)
                .max_capacity(MAX_BYTES)
                .time_to_idle(TIME_TO_IDLE)
                .build(),
        }
    }
}

impl ToolLabelCache {
    pub(crate) fn entries(&self) -> &Cache<ToolLabelCacheKey, Cached<ToolCallLabelMapping>> {
        &self.entries
    }

    /// The mapping kept for `key` when its core pointers all reach a value
    /// in `arguments`. One that no longer fits is dropped.
    pub async fn lookup(
        &self,
        key: &ToolLabelCacheKey,
        arguments: &Value,
    ) -> Option<ToolCallLabelMapping> {
        let mapping = self.entries.get(key).await?;
        if resolve_label(&mapping, arguments).is_ok() {
            return Some((*mapping).clone());
        }
        self.entries.invalidate(key).await;
        None
    }

    pub async fn forget(&self, key: &ToolLabelCacheKey) {
        self.entries.invalidate(key).await;
    }

    /// The mapping for `key`, from `compute` on a miss; concurrent misses of
    /// one key wait for one computation. What `compute` returns is kept only
    /// when it is a model's and fits the `arguments` it was made for.
    pub async fn get_or_compute(
        &self,
        key: ToolLabelCacheKey,
        arguments: &Value,
        compute: impl Future<Output = Option<ToolCallLabelMapping>>,
    ) -> Option<ToolCallLabelMapping> {
        if let Some(mapping) = self.lookup(&key, arguments).await {
            return Some(mapping);
        }
        let owner = key.clone();
        let mapping = self
            .entries
            .optionally_get_with(key, async move {
                compute
                    .await
                    .filter(|mapping| {
                        mapping.source == ToolCallLabelSource::Model
                            && resolve_label(mapping, arguments).is_ok()
                    })
                    .map(|mut mapping| {
                        // No label shows an item past the cap.
                        mapping.items.truncate(MAX_LABEL_ITEMS);
                        mapping.items.shrink_to_fit();
                        Cached::with_key(MEMORY_OWNER, mapping, &owner)
                    })
            })
            .await?;
        // Filled meanwhile by a call of the same shape whose pointers this
        // call's arguments may not have.
        resolve_label(&mapping, arguments)
            .is_ok()
            .then(|| (*mapping).clone())
    }
}

fn weight(key: &ToolLabelCacheKey, mapping: &Cached<ToolCallLabelMapping>) -> u32 {
    let items: usize = mapping
        .items
        .iter()
        .map(|item| {
            let pointers: usize = [
                &item.title,
                &item.id,
                &item.target,
                &item.before,
                &item.after,
            ]
            .into_iter()
            .flatten()
            .chain(&item.fields)
            .map(String::len)
            .sum();
            item.fields.capacity() * size_of::<String>() + pointers
        })
        .sum();
    (size_of::<ToolLabelCacheKey>()
        + key.user_id.len()
        + key.server_id.len()
        + key.tool_name.len()
        + size_of::<ToolCallLabelMapping>()
        + mapping.items.capacity() * size_of::<ToolCallLabelItemMapping>()
        + items)
        .try_into()
        .unwrap_or(u32::MAX)
}

fn shape_digest(arguments: &Value) -> [u8; 32] {
    let mut shape = Shape {
        paths: BTreeSet::new(),
        values: MAX_SHAPE_VALUES,
        path_bytes: MAX_SHAPE_PATH_BYTES,
    };
    shape.walk(arguments, "", 0);
    let verbs: BTreeSet<(&str, &str)> = verb_fields(arguments).into_iter().collect();
    let mut hasher = Sha256::new();
    for (tag, text) in shape.paths.iter().map(|path| (b'p', path.as_str())).chain(
        verbs
            .into_iter()
            .flat_map(|(member, value)| [(b'm', member), (b'v', value)]),
    ) {
        hasher.update([tag]);
        hasher.update((text.len() as u64).to_le_bytes());
        hasher.update(text.as_bytes());
    }
    hasher.finalize().into()
}

/// Scalars are one kind, so a mapping fits a call whatever its scalar types.
fn kind(value: &Value) -> char {
    match value {
        Value::Object(_) => '{',
        Value::Array(_) => '[',
        Value::Null => '0',
        _ => '=',
    }
}

struct Shape {
    paths: BTreeSet<String>,
    values: usize,
    path_bytes: usize,
}

impl Shape {
    fn walk(&mut self, value: &Value, path: &str, depth: usize) {
        if depth == MAX_SHAPE_DEPTH {
            return;
        }
        match value {
            Value::Object(members) => {
                for (name, member) in members {
                    if self.values == 0 {
                        return;
                    }
                    self.child(format!("{path}/{}", escape(name)), member, depth);
                }
            }
            Value::Array(entries) => {
                for entry in entries {
                    if self.values == 0 {
                        return;
                    }
                    self.child(format!("{path}/*"), entry, depth);
                }
            }
            _ => {}
        }
    }

    fn child(&mut self, path: String, value: &Value, depth: usize) {
        self.values -= 1;
        let entry = format!("{}{path}", kind(value));
        if !self.paths.contains(&entry) {
            let Some(left) = self.path_bytes.checked_sub(entry.len()) else {
                self.values = 0;
                return;
            };
            self.path_bytes = left;
        }
        self.walk(value, &path, depth + 1);
        self.paths.insert(entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ToolCallAction, ToolCallObjectKind};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn tool(schema: Value) -> rmcp::model::Tool {
        rmcp::model::Tool::new(
            "records",
            "Works on records.",
            schema.as_object().unwrap().clone(),
        )
    }

    fn schema() -> Value {
        json!({"type": "object", "properties": {
            "mode": {"type": "string"},
            "records": {"type": "array", "items": {"type": "object"}},
        }})
    }

    fn call(mode: &str, names: &[&str]) -> Value {
        let records: Vec<_> = names
            .iter()
            .enumerate()
            .map(|(index, name)| json!({"recordId": format!("rec-{index}"), "company": name}))
            .collect();
        json!({"mode": mode, "records": records})
    }

    fn model(id: &str) -> ToolCallLabelMapping {
        ToolCallLabelMapping {
            action: ToolCallAction::Update,
            object_kind: ToolCallObjectKind::Row,
            items: vec![ToolCallLabelItemMapping {
                id: Some(id.into()),
                title: Some("/records/*/company".into()),
                ..Default::default()
            }],
            source: ToolCallLabelSource::Model,
        }
    }

    struct Labeller {
        runs: AtomicUsize,
        mapping: ToolCallLabelMapping,
    }

    impl Labeller {
        fn new(mapping: ToolCallLabelMapping) -> Self {
            Self {
                runs: AtomicUsize::new(0),
                mapping,
            }
        }

        async fn label(&self) -> Option<ToolCallLabelMapping> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Some(self.mapping.clone())
        }

        fn runs(&self) -> usize {
            self.runs.load(Ordering::SeqCst)
        }
    }

    async fn label(
        cache: &ToolLabelCache,
        labeller: &Labeller,
        user_id: &str,
        tool: &rmcp::model::Tool,
        arguments: &Value,
    ) -> Option<ToolCallLabelMapping> {
        let key = ToolLabelCacheKey::new(user_id, "crm", tool, arguments);
        cache.get_or_compute(key, arguments, labeller.label()).await
    }

    #[tokio::test]
    async fn a_shape_is_labelled_once_and_a_new_shape_verb_schema_or_user_again() {
        let cache = ToolLabelCache::default();
        let labeller = Labeller::new(model("/records/*/recordId"));
        let records = tool(schema());
        let first = call("upsert", &["Acme"]);
        assert_eq!(
            label(&cache, &labeller, "user-a", &records, &first).await,
            Some(model("/records/*/recordId"))
        );
        for arguments in [
            call("upsert", &["Globex"]),
            call("upsert", &["Initech", "Umbrella"]),
            json!({"records": [{"company": "Hooli", "recordId": "rec-9"}], "mode": "upsert"}),
        ] {
            label(&cache, &labeller, "user-a", &records, &arguments).await;
        }
        assert_eq!(labeller.runs(), 1);

        let mut renamed = schema();
        renamed["properties"]["note"] = json!({"type": "string"});
        let mut with_note = first.clone();
        with_note["note"] = json!("Call back on Monday");
        for (case, (user_id, tool, arguments)) in [
            ("user-a", &records, with_note),
            ("user-a", &records, call("merge", &["Acme"])),
            ("user-a", &tool(renamed), first.clone()),
            ("user-b", &records, first.clone()),
        ]
        .into_iter()
        .enumerate()
        {
            let before = labeller.runs();
            label(&cache, &labeller, user_id, tool, &arguments).await;
            assert_eq!(labeller.runs(), before + 1, "case {case}");
        }
    }

    #[tokio::test]
    async fn concurrent_misses_of_one_shape_share_one_labelling() {
        let cache = ToolLabelCache::default();
        let labeller = Labeller::new(model("/records/*/recordId"));
        let records = tool(schema());
        let (one, two) = (call("upsert", &["Acme"]), call("upsert", &["Globex"]));
        let (a, b) = tokio::join!(
            label(&cache, &labeller, "user-a", &records, &one),
            label(&cache, &labeller, "user-a", &records, &two),
        );
        assert_eq!(labeller.runs(), 1);
        assert_eq!(a, Some(model("/records/*/recordId")));
        assert_eq!(b, a);
    }

    #[tokio::test]
    async fn a_mapping_whose_pointer_stops_resolving_is_dropped_and_labelled_again() {
        let cache = ToolLabelCache::default();
        let labeller = Labeller::new(model("/records/1/recordId"));
        let records = tool(schema());
        let two = call("upsert", &["Acme", "Globex"]);
        let one = call("upsert", &["Acme"]);
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &two);
        assert_eq!(key, ToolLabelCacheKey::new("user-a", "crm", &records, &one));

        label(&cache, &labeller, "user-a", &records, &two).await;
        assert!(cache.lookup(&key, &two).await.is_some());
        assert_eq!(cache.lookup(&key, &one).await, None);
        assert!(cache.entries.get(&key).await.is_none());
        assert_eq!(cache.lookup(&key, &two).await, None);

        label(&cache, &labeller, "user-a", &records, &two).await;
        assert_eq!(labeller.runs(), 2);
        assert_eq!(
            label(&cache, &labeller, "user-a", &records, &one).await,
            None
        );
        assert_eq!(labeller.runs(), 3);
        assert!(cache.entries.get(&key).await.is_none());
    }

    #[tokio::test]
    async fn only_a_models_mapping_is_kept() {
        let cache = ToolLabelCache::default();
        let records = tool(schema());
        let arguments = call("upsert", &["Acme"]);
        let rules = Labeller::new(ToolCallLabelMapping {
            source: ToolCallLabelSource::Rules,
            ..model("/records/*/recordId")
        });
        for _ in 0..2 {
            assert_eq!(
                label(&cache, &rules, "user-a", &records, &arguments).await,
                None
            );
        }
        assert_eq!(rules.runs(), 2);
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &arguments);
        assert_eq!(
            cache
                .get_or_compute(key.clone(), &arguments, async { None })
                .await,
            None
        );
        cache.entries.run_pending_tasks().await;
        assert_eq!(cache.entries.entry_count(), 0);
    }

    #[tokio::test]
    async fn a_kept_mapping_holds_no_more_items_than_a_label_shows() {
        let cache = ToolLabelCache::default();
        let records = tool(schema());
        let arguments = call("upsert", &["Acme"]);
        let mut wide = model("/records/*/recordId");
        wide.items = vec![wide.items[0].clone(); MAX_LABEL_ITEMS + 2];
        let labeller = Labeller::new(wide);
        let kept = label(&cache, &labeller, "user-a", &records, &arguments).await;
        assert_eq!(kept.unwrap().items.len(), MAX_LABEL_ITEMS);
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &arguments);
        assert_eq!(
            cache.entries.get(&key).await.unwrap().items.len(),
            MAX_LABEL_ITEMS
        );
    }

    #[tokio::test]
    async fn stored_entries_hold_no_argument_values() {
        let cache = ToolLabelCache::default();
        let labeller = Labeller::new(model("/records/*/recordId"));
        let records = tool(schema());
        let arguments = call("archive_quietly", &["Secret merger with Globex"]);
        label(&cache, &labeller, "user-a", &records, &arguments).await;
        cache.entries.run_pending_tasks().await;
        assert_eq!(cache.entries.entry_count(), 1);
        for (key, mapping) in cache.entries.iter() {
            let stored = format!("{key:?} {}", serde_json::to_string(&*mapping).unwrap());
            for value in ["Secret", "Globex", "rec-0", "archive_quietly"] {
                assert!(!stored.contains(value), "{value}: {stored}");
            }
        }
        assert!(cache.entries.weighted_size() > 0);
    }

    #[test]
    fn a_shape_is_its_member_paths_and_kinds_with_indices_collapsed_and_its_verb_fields() {
        let digest = |value: Value| shape_digest(&value);
        let base = digest(json!({"op": "add", "pages": [{"title": "A"}], "parent": {"id": "p"}}));
        assert_eq!(
            base,
            digest(
                json!({"parent": {"id": "q"}, "pages": [{"title": "B"}, {"title": "C"}], "op": "add"})
            )
        );
        for other in [
            json!({"op": "remove", "pages": [{"title": "A"}], "parent": {"id": "p"}}),
            json!({"op": "add", "pages": [], "parent": {"id": "p"}}),
            json!({"op": "add", "pages": [{"title": "A", "icon": "x"}], "parent": {"id": "p"}}),
            json!({"op": "add", "pages": [{"title": "A"}], "parent": "p"}),
        ] {
            assert_ne!(base, digest(other.clone()), "{other}");
        }
        assert_ne!(
            digest(json!({"op": "add", "mode": "remove"})),
            digest(json!({"op": "remove", "mode": "add"}))
        );
        let kinds: BTreeSet<_> = [
            json!({"x": "s"}),
            json!({"x": null}),
            json!({"x": []}),
            json!({"x": {}}),
        ]
        .into_iter()
        .map(digest)
        .collect();
        assert_eq!(kinds.len(), 4);
        assert_eq!(digest(json!({"x": "s"})), digest(json!({"x": 5})));
        assert_eq!(
            digest(json!({"op": "please delete all of it"})),
            digest(json!({"op": "or rather keep it"}))
        );
        let mut wide: serde_json::Map<_, _> = (0..MAX_SHAPE_VALUES)
            .map(|index| (format!("m{index:04}"), json!(index)))
            .collect();
        let capped = digest(Value::Object(wide.clone()));
        wide.insert("m9999".into(), json!(0));
        assert_eq!(capped, digest(Value::Object(wide)));
    }
}
