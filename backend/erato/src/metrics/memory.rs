//! Logical application payloads. These are not estimates of total allocator usage.

use metrics::{Gauge, Unit, describe_gauge, describe_histogram, gauge, histogram};
use rmcp::model::Tool;
use std::io::{self, Write};

pub(super) fn describe() {
    describe_gauge!(
        "erato_file_upload_chunk_bytes",
        Unit::Bytes,
        "Multipart chunk lengths and copied payload bytes during an awaited storage write; excludes storage-internal retained buffers."
    );
    for kind in ["source", "writer_copy"] {
        gauge!("erato_file_upload_chunk_bytes", "kind" => kind).set(0.0);
    }
    describe_gauge!(
        "erato_attachment_buffer_bytes",
        Unit::Bytes,
        "Owned text and CSV buffer capacities plus attachment vector storage held during attachment planning."
    );
    gauge!("erato_attachment_buffer_bytes").set(0.0);
    describe_gauge!(
        "erato_chat_context_payload_bytes",
        Unit::Bytes,
        "Serialized payload sizes at chat preparation, retained through the initial request's lifetime; excludes later growth and transport buffers."
    );
    for kind in ["internal_messages", "provider_request", "attachment_plans"] {
        gauge!("erato_chat_context_payload_bytes", "kind" => kind).set(0.0);
    }
    describe_gauge!(
        "erato_file_resolution_input_bytes",
        Unit::Bytes,
        "Raw file buffer lengths held while checking extraction limits and building eager attachment previews; excludes the cached copy."
    );
    describe_histogram!(
        "erato_file_resolution_input_size_bytes",
        Unit::Bytes,
        "Input size of each guarded attachment resolution, including previews that bypass the full parser."
    );
    gauge!("erato_file_resolution_input_bytes").set(0.0);
    describe_gauge!(
        "erato_mcp_session_tool_payload_bytes",
        Unit::Bytes,
        "Serialized JSON size of tool lists retained by MCP sessions; excludes transport and TLS allocations."
    );
    describe_gauge!(
        "erato_file_parser_input_bytes",
        Unit::Bytes,
        "Sum of input buffer lengths held by queued or running Xberg parser jobs."
    );
    describe_histogram!(
        "erato_file_parser_input_size_bytes",
        Unit::Bytes,
        "Input size of each file parser call; includes short calls that may fall between gauge scrapes."
    );
    describe_gauge!(
        "erato_runtime_distribution_payload_bytes",
        Unit::Bytes,
        "Payload bytes in the currently published runtime distribution, separated into source and compiled translation bytes."
    );
    gauge!("erato_file_parser_input_bytes").set(0.0);
    describe_gauge!(
        "erato_tokenizer_input_bytes",
        Unit::Bytes,
        "Input text bytes held by queued or running token-count cache-miss jobs; excludes tokenizer internals."
    );
    describe_gauge!(
        "erato_tokenizer_jobs",
        Unit::Count,
        "Queued or running token-count cache-miss jobs, each constructing its own tokenizer."
    );
    gauge!("erato_tokenizer_input_bytes").set(0.0);
    gauge!("erato_tokenizer_jobs").set(0.0);
}

/// Account for the full lifetime of the owner, including error/cancellation paths.
pub(crate) struct PayloadReservation {
    gauge: Gauge,
    bytes: usize,
    owned: Option<super::owned::Reservation>,
}

impl std::fmt::Debug for PayloadReservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PayloadReservation")
            .field("bytes", &self.bytes)
            .finish_non_exhaustive()
    }
}

impl PayloadReservation {
    fn new(gauge: Gauge, bytes: usize) -> Self {
        gauge.increment(bytes as f64);
        Self {
            gauge,
            bytes,
            owned: None,
        }
    }

    pub(crate) fn resize(&mut self, bytes: usize) {
        if bytes >= self.bytes {
            self.gauge.increment((bytes - self.bytes) as f64);
        } else {
            self.gauge.decrement((self.bytes - bytes) as f64);
        }
        self.bytes = bytes;
        if let Some(owned) = &mut self.owned {
            owned.resize_capacity(bytes);
        }
    }
}

impl Drop for PayloadReservation {
    fn drop(&mut self) {
        self.gauge.decrement(self.bytes as f64);
    }
}

#[derive(Default)]
struct ByteCounter(usize);

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn attachment_buffers() -> PayloadReservation {
    let mut reservation = PayloadReservation::new(gauge!("erato_attachment_buffer_bytes"), 0);
    reservation.owned = Some(super::owned::Reservation::new(
        "requests.attachments",
        erato_memory::Usage::default(),
    ));
    reservation
}

pub(crate) fn upload_chunk(kind: &'static str, bytes: usize) -> PayloadReservation {
    let mut guard = PayloadReservation::new(
        gauge!("erato_file_upload_chunk_bytes", "kind" => kind),
        bytes,
    );
    let mut usage = erato_memory::Usage::default();
    let owner = if kind == "writer_copy" {
        usage.capacity = bytes;
        "uploads.writer_copy"
    } else {
        usage.estimated = bytes;
        usage.unmeasured.insert("Bytes shared backing", 1);
        "uploads.source"
    };
    guard.owned = Some(super::owned::Reservation::new(owner, usage));
    guard
}

pub(crate) fn chat_context<T: serde::Serialize + ?Sized>(
    kind: &'static str,
    payload: &T,
) -> PayloadReservation {
    let mut counter = ByteCounter::default();
    if let Err(error) = serde_json::to_writer(&mut counter, payload) {
        tracing::warn!(%error, kind, "Unable to measure chat context payload");
        counter.0 = 0;
    }
    PayloadReservation::new(
        gauge!("erato_chat_context_payload_bytes", "kind" => kind),
        counter.0,
    )
}

pub(crate) fn mcp_tools(server_id: &str, tools: &[Tool]) -> PayloadReservation {
    // Count without allocating another copy of potentially large tool schemas.
    let mut counter = ByteCounter::default();
    if let Err(error) = serde_json::to_writer(&mut counter, tools) {
        tracing::warn!(%error, "Unable to measure MCP tool payload");
        counter.0 = 0;
    }
    PayloadReservation::new(
        gauge!("erato_mcp_session_tool_payload_bytes", "server_id" => server_id.to_owned()),
        counter.0,
    )
}

pub(crate) fn parser_input(bytes: usize) -> PayloadReservation {
    histogram!("erato_file_parser_input_size_bytes").record(bytes as f64);
    PayloadReservation::new(gauge!("erato_file_parser_input_bytes"), bytes)
}

pub(crate) fn file_resolution_input(bytes: usize) -> PayloadReservation {
    histogram!("erato_file_resolution_input_size_bytes").record(bytes as f64);
    PayloadReservation::new(gauge!("erato_file_resolution_input_bytes"), bytes)
}

pub(crate) struct TokenizerReservation {
    _input: PayloadReservation,
    jobs: Gauge,
}

impl Drop for TokenizerReservation {
    fn drop(&mut self) {
        self.jobs.decrement(1.0);
    }
}

pub(crate) fn tokenizer_input(bytes: usize) -> TokenizerReservation {
    let jobs = gauge!("erato_tokenizer_jobs");
    jobs.increment(1.0);
    TokenizerReservation {
        _input: PayloadReservation::new(gauge!("erato_tokenizer_input_bytes"), bytes),
        jobs,
    }
}

impl PayloadReservation {
    pub(crate) fn with_owned<T: erato_memory::HeapSize + ?Sized>(
        mut self,
        owner: &'static str,
        value: &T,
    ) -> Self {
        self.owned = Some(super::owned::Reservation::measured(owner, value));
        self
    }
}
pub(crate) fn parser_input_capacity(length: usize, capacity: usize) -> PayloadReservation {
    let mut guard = parser_input(length);
    guard.owned = Some(super::owned::Reservation::new(
        "jobs.parser.input",
        erato_memory::Usage {
            capacity,
            ..Default::default()
        },
    ));
    guard
}
pub(crate) fn resolution_input_capacity(length: usize, capacity: usize) -> PayloadReservation {
    let mut guard = file_resolution_input(length);
    guard.owned = Some(super::owned::Reservation::new(
        "requests.file_resolution.input",
        erato_memory::Usage {
            capacity,
            ..Default::default()
        },
    ));
    guard
}

impl PayloadReservation {
    pub(crate) fn refresh_owned<T: erato_memory::HeapSize + ?Sized>(&mut self, value: &T) {
        if let Some(owned) = &mut self.owned {
            owned.refresh(value);
        }
    }
}

pub(crate) fn tokenizer_input_capacity(length: usize, capacity: usize) -> TokenizerReservation {
    let mut guard = tokenizer_input(length);
    guard._input.owned = Some(super::owned::Reservation::new(
        "jobs.tokenizer.input",
        erato_memory::Usage {
            capacity,
            ..Default::default()
        },
    ));
    guard
}

#[cfg(test)]
mod tests {
    use super::*;
    use metrics_exporter_prometheus::PrometheusBuilder;

    #[test]
    fn counts_escaped_unicode_tool_payload_without_a_serialized_buffer() {
        let tools: Vec<Tool> = serde_json::from_value(serde_json::json!([{
            "name": "lookup", "description": "Größe\n\"quoted\"",
            "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}
        }]))
        .unwrap();
        let reservation = mcp_tools("test", &tools);
        assert_eq!(reservation.bytes, serde_json::to_vec(&tools).unwrap().len());
    }

    #[test]
    fn attachment_capacity_reservation_tracks_growth_shrink_and_unwind() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let mut first = attachment_buffers();
            first.resize(200);
            let mut second = attachment_buffers();
            second.resize(300);
            first.resize(100);
            assert!(
                handle
                    .render()
                    .contains("erato_attachment_buffer_bytes 400")
            );
            drop(second);
            let _ = std::panic::catch_unwind(|| {
                let mut temporary = attachment_buffers();
                temporary.resize(500);
                panic!("request cancelled");
            });
            assert!(
                handle
                    .render()
                    .contains("erato_attachment_buffer_bytes 100")
            );
            drop(first);
            assert!(handle.render().contains("erato_attachment_buffer_bytes 0"));
        });
    }

    #[test]
    fn chat_context_counts_distinct_copies_and_releases_when_owner_moves() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        let payload = serde_json::json!({"text": "Größe\n\"quoted\""});
        let bytes = serde_json::to_vec(&payload).unwrap().len();
        let owner = metrics::with_local_recorder(&recorder, || {
            let first = chat_context("provider_request", &payload);
            let second = chat_context("provider_request", &payload);
            assert_eq!(first.bytes, bytes);
            assert!(handle.render().contains(&format!(
                "erato_chat_context_payload_bytes{{kind=\"provider_request\"}} {}",
                bytes * 2
            )));
            (first, second)
        });
        std::thread::spawn(move || drop(owner)).join().unwrap();
        assert!(
            handle
                .render()
                .contains("erato_chat_context_payload_bytes{kind=\"provider_request\"} 0")
        );
    }

    #[test]
    fn reservations_sum_and_release_on_drop_and_unwind() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let first = parser_input(100);
            let second = parser_input(50);
            assert!(
                handle
                    .render()
                    .contains("erato_file_parser_input_bytes 150")
            );
            drop(first);
            assert!(handle.render().contains("erato_file_parser_input_bytes 50"));
            let _ = std::panic::catch_unwind(|| {
                let _third = parser_input(20);
                panic!("simulated failure");
            });
            assert!(handle.render().contains("erato_file_parser_input_bytes 50"));
            drop(second);
            assert!(handle.render().contains("erato_file_parser_input_bytes 0"));
        });
    }

    #[test]
    fn tokenizer_jobs_account_for_independent_input_copies() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let first = tokenizer_input(100);
            let second = tokenizer_input(200);
            assert!(handle.render().contains("erato_tokenizer_jobs 2"));
            assert!(handle.render().contains("erato_tokenizer_input_bytes 300"));
            drop(first);
            assert!(handle.render().contains("erato_tokenizer_jobs 1"));
            assert!(handle.render().contains("erato_tokenizer_input_bytes 200"));
            drop(second);
            assert!(handle.render().contains("erato_tokenizer_jobs 0"));
            assert!(handle.render().contains("erato_tokenizer_input_bytes 0"));
        });
    }

    #[test]
    fn preview_buffers_are_accounted_separately_from_parser_inputs() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        metrics::with_local_recorder(&recorder, || {
            let first = file_resolution_input(100);
            let second = file_resolution_input(50);
            assert!(
                handle
                    .render()
                    .contains("erato_file_resolution_input_bytes 150")
            );
            assert!(!handle.render().contains("erato_file_parser_input_bytes"));
            assert!(
                handle
                    .render()
                    .contains("erato_file_resolution_input_size_bytes_count 2")
            );
            assert!(
                handle
                    .render()
                    .contains("erato_file_resolution_input_size_bytes_sum 150")
            );
            drop(first);
            assert!(
                handle
                    .render()
                    .contains("erato_file_resolution_input_bytes 50")
            );
            drop(second);
            assert!(
                handle
                    .render()
                    .contains("erato_file_resolution_input_bytes 0")
            );
        });
    }

    #[tokio::test]
    async fn blocking_job_keeps_accounting_after_awaiting_handle_is_aborted() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        let reservation = metrics::with_local_recorder(&recorder, || parser_input(100));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let job = tokio::task::spawn_blocking(move || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            drop(reservation);
            done_tx.send(()).unwrap();
        });
        started_rx.await.unwrap();
        job.abort();
        assert!(
            handle
                .render()
                .contains("erato_file_parser_input_bytes 100")
        );
        finish_tx.send(()).unwrap();
        done_rx.await.unwrap();
        assert!(handle.render().contains("erato_file_parser_input_bytes 0"));
    }
}
