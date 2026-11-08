//! Model label mappings per user, tool and argument shape. Entries and keys
//! hold no argument value; `mcp_call_mapping` drops a mapping the
//! cross-check rejects, so no hook invalidates entries when a tool's
//! annotations change. An entry is only ever a hint: every label is checked
//! again on the call it is shown for.

use super::pointer::{MAX_POINTER_BYTES, escape};
use super::rules::verb_fields;
use super::{
    MAX_FIELD_POINTERS, MAX_LABEL_ITEMS, ToolCallLabelItemMapping, ToolCallLabelMapping,
    resolve_label,
};
use crate::metrics::owned::Cached;
use crate::models::message::ToolCallLabelSource;
use futures::FutureExt;
use moka::future::Cache;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::time::Duration;

const MAX_BYTES: u64 = 16 * 1024 * 1024;
const TIME_TO_IDLE: Duration = Duration::from_hours(12);
/// However often it is used, a mapping a model was misled into ages out.
const TIME_TO_LIVE: Duration = Duration::from_hours(24);
const MEMORY_OWNER: &str = "app_state.tool_label_cache.values";
/// How long a call waits for its cached mapping before going on without it.
pub const MAX_LOOKUP_TIME: Duration = Duration::from_secs(1);
/// Bytes of a tool's serialized input schema its digest covers; tools that
/// differ only further on share entries, which the checks on every hit
/// still hold to the call.
const MAX_SCHEMA_DIGEST_BYTES: usize = 1024 * 1024;
/// Values one shape walk visits and bytes of the paths it keeps; past either,
/// calls that differ only further on share a key, and the pointer check on
/// every hit still drops a mapping that does not fit.
const MAX_SHAPE_VALUES: usize = 5_000;
const MAX_SHAPE_PATH_BYTES: usize = 64 * 1024;
const MAX_SHAPE_DEPTH: usize = 16;

/// What one model mapping is kept under. Whatever the server or the model
/// sends, a key is the same few bytes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, erato_memory::HeapSize)]
pub struct ToolLabelCacheKey {
    user_id: String,
    server_id: String,
    /// The tool's name and input schema, so a changed tool misses; a key
    /// reorder in the schema only costs a miss.
    tool: [u8; 32],
    /// The arguments' kind and member paths, with array indices as `*` and the
    /// kind of value each holds, and their verb fields with their values.
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
            tool: tool_digest(tool),
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
                .time_to_live(TIME_TO_LIVE)
                .build(),
        }
    }
}

impl ToolLabelCache {
    pub(crate) fn entries(&self) -> &Cache<ToolLabelCacheKey, Cached<ToolCallLabelMapping>> {
        &self.entries
    }

    /// The mapping kept for `key` when it is a model's within the caps and its
    /// core pointers all reach a value in `arguments` that is no consent flag,
    /// `approval_argument` being the server's. One that does not is dropped.
    pub async fn lookup(
        &self,
        key: &ToolLabelCacheKey,
        arguments: &Value,
        approval_argument: Option<&str>,
    ) -> Option<ToolCallLabelMapping> {
        let mapping = self.entries.get(key).await?;
        if keepable(&mapping) && resolve_label(&mapping, arguments, approval_argument).is_ok() {
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
    /// when it is a model's, within the caps, and fits the `arguments` it was
    /// made for as [`Self::lookup`] checks. A panic in `compute` or the cache
    /// gives `None`.
    pub async fn get_or_compute(
        &self,
        key: ToolLabelCacheKey,
        arguments: &Value,
        approval_argument: Option<&str>,
        compute: impl Future<Output = Option<ToolCallLabelMapping>>,
    ) -> Option<ToolCallLabelMapping> {
        AssertUnwindSafe(self.fill(key, arguments, approval_argument, compute))
            .catch_unwind()
            .await
            .unwrap_or_else(|_| {
                tracing::error!(
                    "Keeping no model mapping for a tool call: computing or caching it panicked"
                );
                None
            })
    }

    async fn fill(
        &self,
        key: ToolLabelCacheKey,
        arguments: &Value,
        approval_argument: Option<&str>,
        compute: impl Future<Output = Option<ToolCallLabelMapping>>,
    ) -> Option<ToolCallLabelMapping> {
        if let Some(mapping) = self.lookup(&key, arguments, approval_argument).await {
            return Some(mapping);
        }
        let owner = key.clone();
        let mapping = self
            .entries
            .optionally_get_with(key, async move {
                let mut mapping = compute.await?;
                // No label shows an item or tries a field past the caps.
                mapping.items.truncate(MAX_LABEL_ITEMS);
                mapping.items.shrink_to_fit();
                for item in &mut mapping.items {
                    item.fields.truncate(MAX_FIELD_POINTERS);
                    item.fields.shrink_to_fit();
                }
                let fits = resolve_label(&mapping, arguments, approval_argument).is_ok();
                (keepable(&mapping) && fits)
                    .then(|| Cached::with_key(MEMORY_OWNER, mapping, &owner))
            })
            .await?;
        // Filled meanwhile by a call of the same shape whose pointers this
        // call's arguments may not have.
        resolve_label(&mapping, arguments, approval_argument)
            .is_ok()
            .then(|| (*mapping).clone())
    }
}

/// What `lookup` gives within [`MAX_LOOKUP_TIME`], or whether it panicked
/// or timed out instead.
pub async fn bounded<T>(
    lookup: impl Future<Output = Option<T>>,
) -> Result<Option<T>, &'static str> {
    match tokio::time::timeout(MAX_LOOKUP_TIME, AssertUnwindSafe(lookup).catch_unwind()).await {
        Ok(Ok(found)) => Ok(found),
        Ok(Err(_)) => Err("panicked"),
        Err(_) => Err("timed_out"),
    }
}

/// A model's mapping with no more than a label reads and no pointer too long
/// to reach anything, so an entry stays small whatever the model wrote.
fn keepable(mapping: &ToolCallLabelMapping) -> bool {
    mapping.source == ToolCallLabelSource::Model
        && mapping.items.len() <= MAX_LABEL_ITEMS
        && mapping.items.iter().all(|item| {
            item.fields.len() <= MAX_FIELD_POINTERS
                && pointers(item).all(|pointer| pointer.len() <= MAX_POINTER_BYTES)
        })
}

fn pointers(item: &ToolCallLabelItemMapping) -> impl Iterator<Item = &String> {
    [
        &item.title,
        &item.id,
        &item.target,
        &item.before,
        &item.after,
    ]
    .into_iter()
    .flatten()
    .chain(&item.fields)
}

fn weight(key: &ToolLabelCacheKey, mapping: &Cached<ToolCallLabelMapping>) -> u32 {
    let items: usize = mapping
        .items
        .iter()
        .map(|item| {
            let pointers: usize = pointers(item).map(String::capacity).sum();
            item.fields.capacity() * size_of::<String>() + pointers
        })
        .sum();
    (size_of::<ToolLabelCacheKey>()
        + key.user_id.capacity()
        + key.server_id.capacity()
        + size_of::<ToolCallLabelMapping>()
        + mapping.items.capacity() * size_of::<ToolCallLabelItemMapping>()
        + items)
        .try_into()
        .unwrap_or(u32::MAX)
}

fn tool_digest(tool: &rmcp::model::Tool) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update((tool.name.len() as u64).to_le_bytes());
    hasher.update(tool.name.as_bytes());
    let mut schema = CappedDigest {
        hasher,
        left: MAX_SCHEMA_DIGEST_BYTES,
    };
    // Streamed, so a huge schema costs no copy; an error only means the cap.
    let _ = serde_json::to_writer(&mut schema, &*tool.input_schema);
    schema.hasher.finalize().into()
}

struct CappedDigest {
    hasher: Sha256,
    left: usize,
}

impl std::io::Write for CappedDigest {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let taken = bytes.len().min(self.left);
        self.hasher.update(&bytes[..taken]);
        self.left -= taken;
        if taken < bytes.len() {
            return Err(std::io::Error::other("schema digest cap reached"));
        }
        Ok(taken)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn shape_digest(arguments: &Value) -> [u8; 32] {
    let mut shape = Shape {
        paths: BTreeSet::new(),
        values: MAX_SHAPE_VALUES,
        path_bytes: MAX_SHAPE_PATH_BYTES,
    };
    shape.paths.insert(kind(arguments).to_string());
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
        cache
            .get_or_compute(key, arguments, None, labeller.label())
            .await
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
        assert!(cache.lookup(&key, &two, None).await.is_some());
        assert_eq!(cache.lookup(&key, &one, None).await, None);
        assert!(cache.entries.get(&key).await.is_none());
        assert_eq!(cache.lookup(&key, &two, None).await, None);

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
                .get_or_compute(key.clone(), &arguments, None, async { None })
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

    fn nested(depth: usize) -> Value {
        (0..depth).fold(json!("leaf"), |inner, _| json!({"next": inner}))
    }

    #[test]
    fn a_key_stays_small_and_distinct_whatever_the_server_or_model_sends() {
        let huge = "\u{202E}x\u{0}".repeat(256 * 1024);
        let mut hostile = tool(
            json!({"type": "object", "description": huge.clone(), "properties": {
                "deep": nested(100),
            }}),
        );
        hostile.name = format!("records\n{huge}").into();
        let arguments = json!({
            huge.clone(): {"a/b": "~1", "~0": null},
            "list": (0..10_000).collect::<Vec<_>>(),
            "deep": nested(1_000),
            "\u{202E}": "\u{0}",
        });
        let key = ToolLabelCacheKey::new("user-a", "crm", &hostile, &arguments);
        let shown = format!("{key:?}");
        assert!(shown.len() < 1024, "{} bytes", shown.len());
        assert!(!shown.contains('\u{202E}'), "{shown}");

        let mut renamed = hostile.clone();
        renamed.name = "records".into();
        assert_ne!(
            key,
            ToolLabelCacheKey::new("user-a", "crm", &renamed, &arguments)
        );
        for (one, other) in [
            (json!({"a/b": 1}), json!({"a": {"b": 1}})),
            (json!({"~1": 1}), json!({"/": 1})),
            (json!({"*": [1]}), json!([[1]])),
            (json!({}), json!([])),
            (json!({"a": "s"}), json!("{\"a\": \"s\"}")),
        ] {
            assert_ne!(shape_digest(&one), shape_digest(&other), "{one} {other}");
        }
        // Past the depth cap, calls share a key and the pointer check decides.
        assert_eq!(shape_digest(&nested(100)), shape_digest(&nested(1_000)));
        for scalar in [json!("not json {"), json!(7), json!(null), json!([])] {
            ToolLabelCacheKey::new("user-a", "crm", &hostile, &scalar);
        }
    }

    #[test]
    fn a_schema_counts_toward_its_key_up_to_the_digest_cap() {
        let padded = |tail: &str| {
            let mut schema = schema();
            schema["description"] = json!("x".repeat(MAX_SCHEMA_DIGEST_BYTES));
            schema["zz"] = json!(tail);
            tool(schema)
        };
        let arguments = call("upsert", &["Acme"]);
        let key =
            |tool: &rmcp::model::Tool| ToolLabelCacheKey::new("user-a", "crm", tool, &arguments);
        assert_eq!(key(&padded("one")), key(&padded("two")));
        let mut early = schema();
        early["properties"]["note"] = json!({"type": "string"});
        assert_ne!(key(&tool(schema())), key(&tool(early)));
    }

    #[tokio::test]
    async fn a_kept_entry_stays_small_whatever_the_model_wrote() {
        let cache = ToolLabelCache::default();
        let records = tool(schema());
        let arguments = call("upsert", &["Acme"]);
        let long = format!("/{}", "x".repeat(MAX_POINTER_BYTES));
        let mut wide = model("/records/*/recordId");
        wide.items[0].fields = (0..MAX_FIELD_POINTERS)
            .map(|_| "/records/*/company".to_string())
            .chain(std::iter::repeat_n(long.clone(), 1_000))
            .collect();
        wide.items = vec![wide.items[0].clone(); 10];
        let kept = label(
            &cache,
            &Labeller::new(wide.clone()),
            "user-a",
            &records,
            &arguments,
        )
        .await
        .unwrap();
        assert_eq!(kept.items.len(), MAX_LABEL_ITEMS);
        assert!(
            kept.items
                .iter()
                .all(|item| item.fields.len() == MAX_FIELD_POINTERS)
        );
        // Cutting what no label tries changes no label.
        assert_eq!(
            resolve_label(&kept, &arguments, None),
            resolve_label(&wide, &arguments, None)
        );

        let mut tried = model("/records/*/recordId");
        tried.items[0].fields = vec!["/records/*/company".into(), long.clone()];
        let other = call("merge", &["Acme"]);
        assert_eq!(
            label(&cache, &Labeller::new(tried), "user-a", &records, &other).await,
            None
        );
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &other);
        assert!(cache.entries.get(&key).await.is_none());

        let member = "k".repeat(MAX_POINTER_BYTES - 1);
        let pointer = format!("/{member}");
        let item = ToolCallLabelItemMapping {
            title: Some(pointer.clone()),
            id: Some(pointer.clone()),
            target: Some(pointer.clone()),
            before: Some(pointer.clone()),
            after: Some(pointer.clone()),
            fields: vec![pointer.clone(); MAX_FIELD_POINTERS],
        };
        let largest = ToolCallLabelMapping {
            items: vec![item; MAX_LABEL_ITEMS],
            ..model("/records/*/recordId")
        };
        let arguments = json!({member: "Acme"});
        let key = ToolLabelCacheKey::new(&"u".repeat(36), "crm", &records, &arguments);
        let kept = cache
            .get_or_compute(key.clone(), &arguments, None, async { Some(largest) })
            .await;
        assert!(kept.is_some());
        let entry = cache.entries.get(&key).await.unwrap();
        assert!(weight(&key, &entry) < 48 * 1024, "{}", weight(&key, &entry));
    }

    #[tokio::test]
    async fn an_entry_no_model_wrote_or_past_the_caps_is_dropped_on_lookup() {
        let cache = ToolLabelCache::default();
        let records = tool(schema());
        let arguments = json!({"mode": "upsert", "hasUserApproved": true, "confirm": "yes", "records": [
            {"recordId": "rec-0", "company": "Acme"},
        ]});
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &arguments);
        let fitting = model("/records/*/recordId");
        let mut poisoned = Vec::new();
        for source in [
            ToolCallLabelSource::Rules,
            ToolCallLabelSource::OwnMapping,
            ToolCallLabelSource::Generic,
        ] {
            poisoned.push(ToolCallLabelMapping {
                source,
                ..fitting.clone()
            });
        }
        let mut items = fitting.clone();
        items.items = vec![items.items[0].clone(); MAX_LABEL_ITEMS + 1];
        let mut fields = fitting.clone();
        fields.items[0].fields = vec!["/mode".into(); MAX_FIELD_POINTERS + 1];
        let mut long = fitting.clone();
        long.items[0].fields = vec![format!("/{}", "x".repeat(MAX_POINTER_BYTES))];
        let mut consent = fitting.clone();
        consent.items[0].title = Some("/hasUserApproved".into());
        poisoned.extend([items, fields, long, consent]);
        for mapping in poisoned {
            cache
                .entries
                .insert(
                    key.clone(),
                    Cached::with_key(MEMORY_OWNER, mapping.clone(), &key),
                )
                .await;
            assert_eq!(
                cache.lookup(&key, &arguments, None).await,
                None,
                "{mapping:?}"
            );
            assert!(cache.entries.get(&key).await.is_none(), "{mapping:?}");
        }
        cache
            .entries
            .insert(
                key.clone(),
                Cached::with_key(MEMORY_OWNER, fitting.clone(), &key),
            )
            .await;
        assert_eq!(cache.lookup(&key, &arguments, None).await, Some(fitting));

        // A server's configured consent argument is a flag for that server only.
        let mut confirm = model("/records/*/recordId");
        confirm.items[0].title = Some("/confirm".into());
        for (approval_argument, kept) in [(None, Some(confirm.clone())), (Some("confirm"), None)] {
            cache
                .entries
                .insert(
                    key.clone(),
                    Cached::with_key(MEMORY_OWNER, confirm.clone(), &key),
                )
                .await;
            assert_eq!(
                cache.lookup(&key, &arguments, approval_argument).await,
                kept
            );
        }
        assert!(cache.entries.get(&key).await.is_none());
        let filled = cache
            .get_or_compute(key.clone(), &arguments, Some("confirm"), async {
                Some(confirm.clone())
            })
            .await;
        assert_eq!(filled, None);
        assert!(cache.entries.get(&key).await.is_none());
    }

    #[tokio::test]
    async fn a_panicking_labeller_keeps_nothing_and_leaves_the_cache_working() {
        let cache = ToolLabelCache::default();
        let records = tool(schema());
        let arguments = call("upsert", &["Acme"]);
        let key = ToolLabelCacheKey::new("user-a", "crm", &records, &arguments);
        let panicking = async {
            tokio::task::yield_now().await;
            panic!("a labeller bug")
        };
        let labeller = Labeller::new(model("/records/*/recordId"));
        let (failed, labelled) = tokio::join!(
            cache.get_or_compute(key.clone(), &arguments, None, panicking),
            cache.get_or_compute(key.clone(), &arguments, None, labeller.label()),
        );
        assert_eq!(failed, None);
        assert_eq!(labelled, Some(model("/records/*/recordId")));
        assert_eq!(labeller.runs(), 1);
        assert_eq!(
            cache.lookup(&key, &arguments, None).await,
            Some(model("/records/*/recordId"))
        );
        cache.forget(&key).await;
        assert_eq!(
            cache
                .get_or_compute(key.clone(), &arguments, None, async { panic!("again") })
                .await,
            None
        );
        assert!(cache.entries.get(&key).await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn bounded_gives_a_lookup_its_answer_or_why_it_has_none() {
        assert_eq!(bounded(async { Some(1) }).await, Ok(Some(1)));
        assert_eq!(bounded(async { None::<u8> }).await, Ok(None));
        assert_eq!(
            bounded(async { panic!("a cache bug") as Option<u8> }).await,
            Err("panicked")
        );
        assert_eq!(
            bounded(std::future::pending::<Option<u8>>()).await,
            Err("timed_out")
        );
    }
}
