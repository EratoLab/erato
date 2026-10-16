//! Ownership gauges work with the normal allocator on every platform.
use erato_memory::{Context, HeapSize, Usage};
use metrics::{Gauge, Unit, describe_gauge, gauge};
use std::ops::Deref;
use std::sync::Arc;

pub(super) fn describe() {
    ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    describe_gauge!(
        "erato_owned_memory_bytes",
        Unit::Bytes,
        "Heap storage held by named owners; capacity and estimated container bytes are disjoint. Excludes allocator metadata, freed pages and opaque children."
    );
    describe_gauge!(
        "erato_owned_memory_sample_stale",
        Unit::Count,
        "One when a lock prevented an ownership sample; byte gauges retain their previous sample."
    );
    describe_gauge!(
        "erato_owned_memory_tracked_objects",
        Unit::Count,
        "Live owner reservations; cloned cache handles share one reservation, while AppState clones have independent reservations."
    );
    describe_gauge!(
        "erato_owned_memory_unmeasured_objects",
        Unit::Count,
        "Opaque or locked children whose heap memory is not included in owned bytes; not a byte estimate."
    );
}

/// A reservation belongs to the data owner and releases on drop, including
/// cross-thread frees/cancelled blocking jobs. Never Clone this independently.
#[derive(Debug)]
pub struct Reservation {
    owner: &'static str,
    capacity: Gauge,
    estimated: Gauge,
    objects: Gauge,
    usage: Usage,
    unknown: Vec<(Gauge, usize)>,
}
impl Reservation {
    pub fn new(owner: &'static str, usage: Usage) -> Self {
        let capacity = gauge!("erato_owned_memory_bytes","owner"=>owner,"kind"=>"capacity");
        let estimated = gauge!("erato_owned_memory_bytes","owner"=>owner,"kind"=>"estimated");
        let objects = gauge!("erato_owned_memory_tracked_objects", "owner" => owner);
        objects.increment(1.0);
        capacity.increment(usage.capacity as f64);
        estimated.increment(usage.estimated as f64);
        let unknown = usage
            .unmeasured
            .iter()
            .map(|(&ty, &count)| {
                let gauge =
                    gauge!("erato_owned_memory_unmeasured_objects","owner"=>owner,"type"=>ty);
                gauge.increment(count as f64);
                (gauge, count)
            })
            .collect();
        Self {
            owner,
            capacity,
            estimated,
            objects,
            usage,
            unknown,
        }
    }
    pub fn measured<T: HeapSize + ?Sized>(owner: &'static str, value: &T) -> Self {
        Self::new(
            owner,
            if enabled() {
                erato_memory::measure_owned(value)
            } else {
                Usage::default()
            },
        )
    }

    pub(crate) fn refresh<T: HeapSize + ?Sized>(&mut self, value: &T) {
        self.replace(if enabled() {
            erato_memory::measure_owned(value)
        } else {
            Usage::default()
        });
    }
    pub(crate) fn replace(&mut self, usage: Usage) {
        self.resize_capacity(usage.capacity);
        if usage.estimated >= self.usage.estimated {
            self.estimated
                .increment((usage.estimated - self.usage.estimated) as f64)
        } else {
            self.estimated
                .decrement((self.usage.estimated - usage.estimated) as f64)
        }
        for (g, count) in &self.unknown {
            g.decrement(*count as f64);
        }
        self.unknown = usage
            .unmeasured
            .iter()
            .map(|(&ty, &count)| {
                let g =
                    gauge!("erato_owned_memory_unmeasured_objects","owner"=>self.owner,"type"=>ty);
                g.increment(count as f64);
                (g, count)
            })
            .collect();
        self.usage = usage;
    }
    pub fn resize_capacity(&mut self, bytes: usize) {
        if bytes >= self.usage.capacity {
            self.capacity
                .increment((bytes - self.usage.capacity) as f64)
        } else {
            self.capacity
                .decrement((self.usage.capacity - bytes) as f64)
        }
        self.usage.capacity = bytes;
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        self.objects.decrement(1.0);
        self.capacity.decrement(self.usage.capacity as f64);
        self.estimated.decrement(self.usage.estimated as f64);
        for (g, count) in &self.unknown {
            g.decrement(*count as f64);
        }
    }
}

#[derive(Debug)]
struct CachedInner<T> {
    value: T,
    _memory: Reservation,
}
/// Cache reads/inspection clone this Arc, never its large backing buffer.
#[derive(Debug)]
pub struct Cached<T>(Arc<CachedInner<T>>);
impl<T> Clone for Cached<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<T> Deref for Cached<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0.value
    }
}
impl<T: HeapSize> Cached<T> {
    pub fn new(owner: &'static str, value: T) -> Self {
        let mut usage = if enabled() {
            erato_memory::measure_owned(&value)
        } else {
            Usage::default()
        };
        usage.estimated += std::mem::size_of::<CachedInner<T>>() + 2 * std::mem::size_of::<usize>();
        let memory = Reservation::new(owner, usage);
        Self(Arc::new(CachedInner {
            value,
            _memory: memory,
        }))
    }
    pub fn with_key<K: HeapSize + Clone>(owner: &'static str, value: T, key: &K) -> Self {
        let mut c = Context::for_owned();
        if enabled() {
            c.measure(&value);
            c.measure(&key.clone());
        }
        let mut usage = c.finish();
        usage.estimated += std::mem::size_of::<CachedInner<T>>()
            + std::mem::size_of::<K>()
            + 4 * std::mem::size_of::<usize>();
        let memory = Reservation::new(owner, usage);
        Self(Arc::new(CachedInner {
            value,
            _memory: memory,
        }))
    }
}

/// Accounts for a borrowed process-global tokenizer without cloning its state.
/// The application keeps exactly one wrapper alive for the process lifetime.
pub(crate) struct Tokenizer {
    inner: &'static tiktoken_rs::CoreBPE,
    _memory: Reservation,
}
impl Tokenizer {
    pub fn o200k_base(owner: &'static str, inner: &'static tiktoken_rs::CoreBPE) -> Self {
        static ESTIMATE: std::sync::OnceLock<Usage> = std::sync::OnceLock::new();
        let usage = if enabled() {
            ESTIMATE
                .get_or_init(|| estimate_o200k_tokenizer(inner))
                .clone()
        } else {
            Usage::default()
        };
        Self {
            inner,
            _memory: Reservation::new(owner, usage),
        }
    }
}

/// tiktoken-rs 0.12.0 o200k has 199,998 dense mergeable ranks. Its encoder,
/// decoder and sorted-token index own three copies of those bytes. Estimate
/// Vec metadata and two SwissTable maps from public token lengths/counts.
/// Neither private capacities nor regex storage are exposed, so every byte
/// here belongs to `estimated`; opaque counts identify the remaining gap.
fn estimate_o200k_tokenizer(inner: &tiktoken_rs::CoreBPE) -> Usage {
    const MERGEABLE_TOKENS: tiktoken_rs::Rank = 199_998;
    let mut c = Context::default();
    let mut tokens = 0;
    let mut bytes = 0;
    for rank in 0..MERGEABLE_TOKENS {
        match inner.decode_bytes(&[rank]) {
            Ok(token) => {
                tokens += 1;
                bytes += token.len();
            }
            Err(_) => {
                c.unmeasured("unexpected o200k vocabulary", 1);
                break;
            }
        }
    }
    let specials = inner.special_tokens();
    let special_bytes: usize = specials.iter().map(|token| token.len()).sum();
    let table = |entries: usize, entry_size| {
        if entries == 0 {
            0
        } else {
            // Standard HashMap's 7/8 load factor. Private spare capacity can
            // differ; this models only the tables required by these entries.
            let buckets = (entries * 8).div_ceil(7).next_power_of_two();
            erato_memory::estimate_hash_table(buckets * 7 / 8, entry_size)
        }
    };
    c.estimated(
        3 * bytes
            + tokens * std::mem::size_of::<Vec<u8>>()
            + 2 * special_bytes
            + table(tokens, std::mem::size_of::<(Vec<u8>, tiktoken_rs::Rank)>())
            + table(tokens, std::mem::size_of::<(tiktoken_rs::Rank, Vec<u8>)>())
            + table(
                specials.len(),
                std::mem::size_of::<(String, tiktoken_rs::Rank)>(),
            )
            + table(
                specials.len(),
                std::mem::size_of::<(tiktoken_rs::Rank, Vec<u8>)>(),
            ),
    );
    c.unmeasured(
        "tiktoken private spare capacity and compiled regex state",
        1,
    );
    c.finish()
}
impl Deref for Tokenizer {
    type Target = tiktoken_rs::CoreBPE;
    fn deref(&self) -> &Self::Target {
        self.inner
    }
}
impl<T: HeapSize> Cached<T> {
    pub fn with_string_key(owner: &'static str, value: T, key: &str) -> Self {
        // Moka's by-reference str lookup creates its owned String using to_owned.
        let mut usage = if enabled() {
            erato_memory::measure_owned(&value)
        } else {
            Usage::default()
        };
        usage.capacity += key.len();
        usage.estimated += std::mem::size_of::<CachedInner<T>>()
            + std::mem::size_of::<String>()
            + 4 * std::mem::size_of::<usize>();
        Self(Arc::new(CachedInner {
            value,
            _memory: Reservation::new(owner, usage),
        }))
    }
}

pub(crate) struct ToolView<'a>(pub &'a rmcp::model::Tool);
impl HeapSize for ToolView<'_> {
    fn heap_size(&self, c: &mut Context) {
        self.0.name.heap_size(c);
        self.0.title.heap_size(c);
        self.0.description.heap_size(c);
        self.0.input_schema.heap_size(c);
        self.0.output_schema.heap_size(c);
        if let Some(a) = &self.0.annotations {
            a.title.heap_size(c);
        }
        if let Some(icons) = &self.0.icons {
            c.capacity(icons.capacity() * std::mem::size_of::<rmcp::model::Icon>());
            for icon in icons {
                icon.src.heap_size(c);
                icon.mime_type.heap_size(c);
                icon.sizes.heap_size(c);
            }
        }
        if let Some(meta) = &self.0.meta {
            c.opaque(meta);
        }
    }
}
impl HeapSize for crate::services::mcp_tool_annotations::ResolvedMcpTool {
    fn heap_size(&self, c: &mut Context) {
        ToolView(&self.tool).heap_size(c);
        if let Some(a) = &self.server_annotations {
            a.title.heap_size(c);
        }
    }
}

static ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) fn enabled() -> bool {
    ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

pub(crate) struct ProviderRequestView<'a>(pub &'a genai::chat::ChatRequest);
impl HeapSize for ProviderRequestView<'_> {
    fn heap_size(&self, c: &mut Context) {
        use genai::chat::{ContentPart, ToolName};
        self.0.system.heap_size(c);
        self.0.previous_response_id.heap_size(c);
        c.capacity(self.0.messages.capacity() * std::mem::size_of::<genai::chat::ChatMessage>());
        for message in &self.0.messages {
            let parts = &message.content;
            // genai exposes parts by reference, but not the private Vec capacity.
            c.estimated(parts.into_iter().count() * std::mem::size_of::<ContentPart>());
            c.unmeasured("genai MessageContent spare capacity", 1);
            for part in parts {
                match part {
                    ContentPart::Text(v)
                    | ContentPart::ThoughtSignature(v)
                    | ContentPart::ReasoningContent(v) => v.heap_size(c),
                    ContentPart::ToolCall(v) => {
                        v.call_id.heap_size(c);
                        v.fn_name.heap_size(c);
                        v.fn_arguments.heap_size(c);
                        v.thought_signatures.heap_size(c);
                    }
                    ContentPart::ToolResponse(v) => {
                        v.call_id.heap_size(c);
                        v.fn_name.heap_size(c);
                        v.content.heap_size(c);
                    }
                    ContentPart::ReasoningItem(v) => {
                        v.id.heap_size(c);
                        v.content.heap_size(c);
                        v.encrypted_content.heap_size(c);
                        v.status.heap_size(c);
                        c.capacity(
                            v.summary.capacity()
                                * std::mem::size_of::<genai::chat::ReasoningSummaryText>(),
                        );
                        for summary in &v.summary {
                            summary.text.heap_size(c);
                            summary.r#type.heap_size(c);
                        }
                    }
                    ContentPart::Custom(v) => {
                        v.data.heap_size(c);
                        if v.model_iden.is_some() {
                            c.opaque(&v.model_iden);
                        }
                    }
                    ContentPart::Binary(v) => {
                        v.content_type.heap_size(c);
                        v.name.heap_size(c);
                        match &v.source {
                            genai::chat::BinarySource::Url(s) => s.heap_size(c),
                            genai::chat::BinarySource::Base64(s) => s.heap_size(c),
                        }
                    }
                }
            }
            if message.options.is_some() {
                c.opaque(&message.options);
            }
        }
        if let Some(tools) = &self.0.tools {
            c.capacity(tools.capacity() * std::mem::size_of::<genai::chat::Tool>());
            for tool in tools {
                if let ToolName::Custom(name) = &tool.name {
                    name.heap_size(c);
                }
                tool.description.heap_size(c);
                tool.schema.heap_size(c);
                tool.custom_format.heap_size(c);
                if tool.config.is_some() {
                    c.opaque(&tool.config);
                }
            }
        }
    }
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Snapshot {
    pub owners: std::collections::BTreeMap<String, Usage>,
}
impl Snapshot {
    pub(crate) fn record<T: HeapSize + ?Sized>(
        &mut self,
        c: &mut Context,
        owner: &'static str,
        value: &T,
    ) {
        c.measure(value);
        self.owners.insert(owner.to_owned(), c.take_usage());
    }
    pub(crate) fn opaque<T: ?Sized>(&mut self, c: &mut Context, owner: &'static str, value: &T) {
        c.opaque(value);
        self.owners.insert(owner.to_owned(), c.take_usage());
    }
}

/// No request IDs, schema keys, filenames, secret values or dynamic paths are
/// used as labels. The dotted owner names form the ownership hierarchy.
pub fn start_reporter(
    state: crate::state::AppState,
    frontend: Arc<crate::frontend_environment::FrontendRegistry>,
) {
    if !enabled() {
        return;
    }
    tokio::spawn(async move {
        let mut previous = Snapshot::default();
        let mut interval = tokio::time::interval(super::MEMORY_STATS_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let mut c = Context::default();
            let mut report = state.owned_memory_snapshot(&mut c);
            report.record(&mut c, "shared.frontend_registry", &frontend);
            c.unmeasured("Prometheus recorder/histogram internals", 1);
            report
                .owners
                .insert("shared.metrics_exporter".into(), c.take_usage());
            c.unmeasured("Axum routing and handler enclosing storage", 1);
            report
                .owners
                .insert("shared.http_framework".into(), c.take_usage());
            c.unmeasured("Tokio scheduler, task frames and native stacks", 1);
            report
                .owners
                .insert("shared.runtime".into(), c.take_usage());
            for (ty, usage) in erato_memory::shared_roots(&mut c) {
                report
                    .owners
                    .insert(format!("shared.allocations.{ty}"), usage);
            }
            publish(&mut report, &previous);
            tracing::debug!(memory_report=%serde_json::to_string(&report).unwrap_or_default(),"Owned memory snapshot");
            previous = report;
        }
    });
}

fn publish(report: &mut Snapshot, previous: &Snapshot) {
    for (owner, old) in &previous.owners {
        let owner = owner.as_str();
        for &ty in old.unmeasured.keys() {
            gauge!("erato_owned_memory_unmeasured_objects","owner"=>owner.to_owned(),"type"=>ty)
                .set(0.0);
        }
        if !report.owners.contains_key(owner) {
            gauge!("erato_owned_memory_sample_stale", "owner" => owner.to_owned()).set(0.0);
            for kind in ["capacity", "estimated"] {
                gauge!("erato_owned_memory_bytes","owner"=>owner.to_owned(),"kind"=>kind).set(0.0);
            }
        }
    }
    for (owner, usage) in &mut report.owners {
        if usage.locked
            && let Some(old) = previous.owners.get(owner)
        {
            usage.capacity = old.capacity;
            usage.estimated = old.estimated;
        }
        let owner = owner.as_str();
        gauge!("erato_owned_memory_sample_stale","owner"=>owner.to_owned()).set(if usage.locked {
            1.0
        } else {
            0.0
        });
        gauge!("erato_owned_memory_bytes","owner"=>owner.to_owned(),"kind"=>"capacity")
            .set(usage.capacity as f64);
        gauge!("erato_owned_memory_bytes","owner"=>owner.to_owned(),"kind"=>"estimated")
            .set(usage.estimated as f64);
        for (&ty, &count) in &usage.unmeasured {
            gauge!("erato_owned_memory_unmeasured_objects","owner"=>owner.to_owned(),"type"=>ty)
                .set(count as f64);
        }
    }
}

pub(crate) struct RegorusValueView<'a>(pub &'a regorus::Value);
impl HeapSize for RegorusValueView<'_> {
    fn heap_size(&self, c: &mut Context) {
        use regorus::Value;
        match self.0 {
            Value::String(value) => {
                if c.shared(value.as_ref().as_ptr() as usize) {
                    c.estimated(value.len() + 2 * std::mem::size_of::<usize>());
                }
            }
            Value::Array(value) => {
                if c.shared(&**value as *const _ as usize) {
                    c.estimated(std::mem::size_of_val(&**value) + 2 * std::mem::size_of::<usize>());
                    c.capacity(value.capacity() * std::mem::size_of::<Value>());
                    for v in value.iter() {
                        RegorusValueView(v).heap_size(c);
                    }
                }
            }
            Value::Set(value) => {
                if c.shared(&**value as *const _ as usize) {
                    c.estimated(
                        std::mem::size_of_val(&**value)
                            + 2 * std::mem::size_of::<usize>()
                            + value.len()
                                * (std::mem::size_of::<Value>() + 3 * std::mem::size_of::<usize>()),
                    );
                    for v in value.iter() {
                        RegorusValueView(v).heap_size(c);
                    }
                }
            }
            Value::Object(value) => {
                if c.shared(&**value as *const _ as usize) {
                    c.estimated(
                        std::mem::size_of_val(&**value)
                            + 2 * std::mem::size_of::<usize>()
                            + value.len()
                                * (2 * std::mem::size_of::<Value>()
                                    + 3 * std::mem::size_of::<usize>()),
                    );
                    for (k, v) in value.iter() {
                        RegorusValueView(k).heap_size(c);
                        RegorusValueView(v).heap_size(c);
                    }
                }
            }
            Value::Number(value) => c.opaque(value),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metrics_exporter_prometheus::PrometheusBuilder;

    #[test]
    fn external_tokenizer_estimate_preserves_encoding_and_releases_with_owner() {
        let inner = tiktoken_rs::o200k_base_singleton();
        let text = "Hello, world! Grüße aus Berlin. 東京";
        let tokens = inner.encode_ordinary(text);
        let usage = estimate_o200k_tokenizer(inner);
        assert_eq!(usage.capacity, 0);
        assert!(usage.estimated > 24 * 1024 * 1024);
        assert!(usage.estimated < 26 * 1024 * 1024);
        assert!(!usage.unmeasured.contains_key("unexpected o200k vocabulary"));
        assert_eq!(inner.encode_ordinary(text), tokens);
        assert_eq!(inner.decode(&tokens).unwrap(), text);
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            describe();
            let tokenizer = Tokenizer::o200k_base("test.external_tokenizer", inner);
            assert_eq!(tokenizer.encode_ordinary(text), tokens);
            assert!(handle.render().contains(&format!(
                "erato_owned_memory_bytes{{owner=\"test.external_tokenizer\",kind=\"estimated\"}} {}",
                usage.estimated
            )));
            drop(tokenizer);
            assert!(handle.render().contains(
                "erato_owned_memory_bytes{owner=\"test.external_tokenizer\",kind=\"estimated\"} 0"
            ));
        });
    }

    #[test]
    fn cache_handle_aliases_do_not_duplicate_or_extend_payload_after_last_owner() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            describe();
            let mut bytes = Vec::with_capacity(1024);
            bytes.extend_from_slice(b"abc");
            let value = Cached::new("test.cache_lifetime", bytes);
            let clone = value.clone();
            assert_eq!(value.as_ptr(), clone.as_ptr());
            assert!(handle.render().contains(
                "erato_owned_memory_bytes{owner=\"test.cache_lifetime\",kind=\"capacity\"} 1024"
            ));
            drop(value);
            std::thread::spawn(move || drop(clone)).join().unwrap();
            assert!(handle.render().contains(
                "erato_owned_memory_bytes{owner=\"test.cache_lifetime\",kind=\"capacity\"} 0"
            ));
        });
    }
    #[test]
    fn mutation_updates_capacities_and_drop_releases_even_when_unwinding() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let result = std::panic::catch_unwind(|| {
                let mut guard = Reservation::new(
                    "test.mutable",
                    Usage {
                        capacity: 100,
                        ..Default::default()
                    },
                );
                guard.replace(Usage {
                    capacity: 700,
                    estimated: 33,
                    ..Default::default()
                });
                assert!(handle.render().contains(
                    "erato_owned_memory_bytes{owner=\"test.mutable\",kind=\"capacity\"} 700"
                ));
                panic!("cancel owner");
            });
            assert!(result.is_err());
            assert!(
                handle.render().contains(
                    "erato_owned_memory_bytes{owner=\"test.mutable\",kind=\"capacity\"} 0"
                )
            );
            assert!(
                handle.render().contains(
                    "erato_owned_memory_bytes{owner=\"test.mutable\",kind=\"estimated\"} 0"
                )
            );
        });
    }
    #[test]
    fn locked_snapshots_keep_previous_bytes_and_removed_owners_are_cleared() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let mut previous = Snapshot::default();
            previous.owners.insert(
                "test.locked".into(),
                Usage {
                    capacity: 800,
                    estimated: 20,
                    ..Default::default()
                },
            );
            let mut current = Snapshot::default();
            current.owners.insert(
                "test.locked".into(),
                Usage {
                    locked: true,
                    ..Default::default()
                },
            );
            publish(&mut current, &previous);
            assert_eq!(current.owners["test.locked"].capacity, 800);
            assert_eq!(current.owners["test.locked"].estimated, 20);
            assert!(
                handle
                    .render()
                    .contains("erato_owned_memory_sample_stale{owner=\"test.locked\"} 1")
            );
            let mut empty = Snapshot::default();
            publish(&mut empty, &current);
            assert!(
                handle.render().contains(
                    "erato_owned_memory_bytes{owner=\"test.locked\",kind=\"capacity\"} 0"
                )
            );
            assert!(
                handle
                    .render()
                    .contains("erato_owned_memory_sample_stale{owner=\"test.locked\"} 0")
            );
        });
    }
}
