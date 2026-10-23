//! Progress trace of a delegated child run, folded from the child's streaming
//! events and rendered under the parent chat's delegation tool step.

use crate::services::background_tasks::{StreamingEvent, ToolCallStatus};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

/// The frontend sanitizer drops steps past this count.
const MAX_STEPS: usize = 32;

/// The schema permits 512; a detail is a label, never a message.
const MAX_DETAIL_CHARS: usize = 120;

/// Step id of the delegate's final answer.
const ANSWER_STEP_ID: &str = "answer";

/// The schema's bound on a step's `counts`.
const MAX_COUNTS: usize = 16;

/// Longest freshness token or count key a step repeats from a host.
const MAX_HOST_TOKEN_CHARS: usize = 32;

/// For each granted client tool, by model-facing name, the input paths that
/// name the part a call read.
pub type ClientReadFields = HashMap<String, Vec<Vec<String>>>;

/// One step of a delegated run. Wire shape is `SidecarLocalTraceStep`, whose
/// canonical schema lives in
/// `desktop-sidecar-protocol/schemas/outlook/local-trace-step.schema.json` —
/// the frontend renderer and its sanitizer are written against that file, so
/// field names and value ranges must follow it rather than Rust convention.
/// The optional `parentSequence` is deliberately never emitted: v1 traces are
/// flat, and the nesting the user sees comes from the trace as a whole hanging
/// under the parent's delegation step.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationTraceStep {
    pub sequence: u32,
    pub id: String,
    pub status: DelegationTraceStepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_offset_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// A granted client read's freshness counts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<BTreeMap<String, u64>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DelegationTraceStepStatus {
    Running,
    Ok,
    Error,
    Degraded,
}

/// The cumulative trace carried by every progress frame and by the persisted
/// tool output.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationTrace {
    pub steps: Vec<DelegationTraceStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_duration_ms: Option<u64>,
}

/// How urgently a change wants a frame of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceChange {
    /// A step opened or reached a terminal status.
    Structural,
    /// An open step advanced without changing the shape of the trace.
    Progress,
}

/// Folds a delegated child's event stream into a trace.
///
/// Only metadata is kept. The trace is rendered in the PARENT's chat, so the
/// child's text — model output, and everything the delegate's tools returned
/// into it — must never reach a step: step ids are tool names and `detail`
/// carries error discriminants. A granted client read adds the part it asked
/// for and the freshness the host reported, never what it read.
pub struct DelegationTraceCollector {
    started: Instant,
    steps: Vec<DelegationTraceStep>,
    step_by_tool_call: HashMap<String, usize>,
    answer_step: Option<usize>,
    total_duration_ms: Option<u64>,
    version: u64,
    client_reads: ClientReadFields,
}

impl DelegationTraceCollector {
    pub fn new(started: Instant) -> Self {
        Self {
            started,
            steps: Vec::new(),
            step_by_tool_call: HashMap::new(),
            answer_step: None,
            total_duration_ms: None,
            version: 0,
            client_reads: HashMap::new(),
        }
    }

    /// Goes on from the trace a parked run left behind, so the steps of the
    /// resumed run follow the ones the user has already seen.
    pub fn resumed(trace: DelegationTrace) -> Self {
        let parked_for = Duration::from_millis(trace.total_duration_ms.unwrap_or(0));
        let mut collector = Self::new(
            Instant::now()
                .checked_sub(parked_for)
                .unwrap_or_else(Instant::now),
        );
        collector.steps = trace.steps;
        collector.steps.truncate(MAX_STEPS);
        collector
    }

    pub fn with_client_reads(mut self, client_reads: ClientReadFields) -> Self {
        self.client_reads = client_reads;
        self
    }

    /// Bumped on every change, so an emitter can tell whether the trace it
    /// last sent is still current.
    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn snapshot(&self) -> DelegationTrace {
        DelegationTrace {
            steps: self.steps.clone(),
            total_duration_ms: self.total_duration_ms,
        }
    }

    /// Folds one child event in, reporting whether — and how urgently — the
    /// trace changed.
    pub fn apply(&mut self, event: &StreamingEvent) -> Option<TraceChange> {
        match event {
            StreamingEvent::ToolCallProposed {
                tool_call_id,
                tool_name,
                ..
            } => {
                self.step_for_call(tool_call_id, tool_name)?;
                Some(TraceChange::Structural)
            }
            StreamingEvent::ToolCallUpdate {
                tool_call_id,
                tool_name,
                status,
                input,
                output,
                ..
            } => {
                // A resumed run goes on with the call its park left open
                // without proposing it again.
                let index = match self.step_by_tool_call.get(tool_call_id) {
                    Some(index) => *index,
                    None => self.step_for_call(tool_call_id, tool_name)?,
                };
                if matches!(status, ToolCallStatus::Success) {
                    self.report_client_read(index, tool_name, input.as_ref(), output.as_ref());
                }
                let (status, change) = match status {
                    ToolCallStatus::Preparing | ToolCallStatus::InProgress => {
                        (DelegationTraceStepStatus::Running, TraceChange::Progress)
                    }
                    ToolCallStatus::Success => {
                        (DelegationTraceStepStatus::Ok, TraceChange::Structural)
                    }
                    ToolCallStatus::Error => {
                        (DelegationTraceStepStatus::Error, TraceChange::Structural)
                    }
                };
                self.set_step_status(index, status, None);
                Some(change)
            }
            // Which text is the answer is only knowable in hindsight — a model
            // narrating what it is about to do streams text before it calls
            // anything. The step opens on the first text of a run so a
            // text-only child has something live to show, and a tool call
            // proposed afterwards takes it back.
            StreamingEvent::TextDelta { .. } => {
                if self.answer_step.is_some() {
                    return None;
                }
                self.answer_step = Some(self.open_step(ANSWER_STEP_ID.to_string())?);
                Some(TraceChange::Structural)
            }
            StreamingEvent::AssistantMessageCompleted { .. } => {
                let index = self.answer_step?;
                self.set_step_status(index, DelegationTraceStepStatus::Ok, None);
                Some(TraceChange::Structural)
            }
            StreamingEvent::Error { error } => {
                let detail = error
                    .as_ref()
                    .and_then(|error| error.get("error_type"))
                    .and_then(|error_type| error_type.as_str())
                    .map(bounded_detail);
                self.settle_running(DelegationTraceStepStatus::Error, detail)
                    .then_some(TraceChange::Structural)
            }
            _ => None,
        }
    }

    /// Closes the trace. Steps still open never reported an outcome — the tap
    /// stopped before they did, which is the normal shape of a timed-out or
    /// cancelled run — so they settle as `degraded` rather than fabricating
    /// success or failure.
    pub fn finish(&mut self) {
        if self.steps.is_empty() {
            return;
        }
        self.settle_running(DelegationTraceStepStatus::Degraded, None);
        self.total_duration_ms = Some(self.elapsed_ms());
        self.version += 1;
    }

    /// Drops an answer step that text turned out to have opened too early, so
    /// the answer stays last and is timed by the run that produced it. The
    /// step is always the most recent one, and the sequence it frees is taken
    /// by the tool step opened right after: a consumer merging frames by
    /// sequence sees the replacement rather than a step that disappears.
    fn retract_open_answer(&mut self) {
        let Some(index) = self.answer_step else {
            return;
        };
        let open = self
            .steps
            .get(index)
            .is_some_and(|step| step.status == DelegationTraceStepStatus::Running);
        if !open || index + 1 != self.steps.len() {
            return;
        }
        self.steps.pop();
        self.answer_step = None;
        self.version += 1;
    }

    /// The step a call reports on: the one its run's park left open, or a
    /// new one. A park leaves `degraded` exactly the calls it stopped on, and
    /// nothing else in a running trace is.
    fn step_for_call(&mut self, tool_call_id: &str, tool_name: &str) -> Option<usize> {
        self.retract_open_answer();
        let parked = self.steps.iter().enumerate().rposition(|(index, step)| {
            step.id == tool_name
                && step.status == DelegationTraceStepStatus::Degraded
                && !self.step_by_tool_call.values().any(|taken| *taken == index)
        });
        let index = match parked {
            Some(index) => {
                let elapsed = self.elapsed_ms();
                let step = &mut self.steps[index];
                step.status = DelegationTraceStepStatus::Running;
                step.started_at_offset_ms = Some(elapsed);
                step.duration_ms = None;
                self.version += 1;
                index
            }
            None => self.open_step(tool_name.to_string())?,
        };
        self.step_by_tool_call
            .insert(tool_call_id.to_string(), index);
        Some(index)
    }

    /// Writes what a granted client read's step says: the part it asked for
    /// and the freshness the host reported. Any other tool's step is left be.
    fn report_client_read(
        &mut self,
        index: usize,
        tool_name: &str,
        input: Option<&Value>,
        output: Option<&Value>,
    ) {
        let Some(paths) = self.client_reads.get(tool_name) else {
            return;
        };
        let part = paths
            .iter()
            .filter_map(|path| {
                let value = path
                    .iter()
                    .try_fold(input?, |value, key| value.get(key.as_str()))?;
                match value {
                    Value::String(text) => Some(text.clone()),
                    Value::Number(number) => Some(number.to_string()),
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let freshness = output.and_then(|output| output.pointer("/result/freshness"));
        let changes = freshness
            .and_then(|freshness| freshness.get("changes"))
            .and_then(Value::as_str)
            .filter(|changes| host_token(changes));
        let counts: BTreeMap<String, u64> = freshness
            .and_then(|freshness| freshness.get("counts"))
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(key, _)| host_token(key))
            .filter_map(|(key, count)| Some((key.clone(), count.as_u64()?)))
            .take(MAX_COUNTS)
            .collect();
        let detail = match (part.is_empty(), changes) {
            (false, Some(changes)) => Some(format!("{part} · changes: {changes}")),
            (false, None) => Some(part),
            (true, Some(changes)) => Some(format!("changes: {changes}")),
            (true, None) => None,
        };
        if let Some(step) = self.steps.get_mut(index) {
            step.detail = detail.as_deref().map(bounded_detail);
            step.counts = (!counts.is_empty()).then_some(counts);
        }
    }

    fn open_step(&mut self, id: String) -> Option<usize> {
        if self.steps.len() >= MAX_STEPS {
            return None;
        }
        let index = self.steps.len();
        self.steps.push(DelegationTraceStep {
            sequence: index as u32,
            id,
            status: DelegationTraceStepStatus::Running,
            started_at_offset_ms: Some(self.elapsed_ms()),
            duration_ms: None,
            detail: None,
            counts: None,
        });
        self.version += 1;
        Some(index)
    }

    fn set_step_status(
        &mut self,
        index: usize,
        status: DelegationTraceStepStatus,
        detail: Option<String>,
    ) {
        let elapsed = self.elapsed_ms();
        let Some(step) = self.steps.get_mut(index) else {
            return;
        };
        step.duration_ms = Some(elapsed.saturating_sub(step.started_at_offset_ms.unwrap_or(0)));
        step.status = status;
        if detail.is_some() {
            step.detail = detail;
        }
        self.version += 1;
    }

    fn settle_running(
        &mut self,
        status: DelegationTraceStepStatus,
        detail: Option<String>,
    ) -> bool {
        let open: Vec<usize> = self
            .steps
            .iter()
            .enumerate()
            .filter(|(_, step)| step.status == DelegationTraceStepStatus::Running)
            .map(|(index, _)| index)
            .collect();
        for index in &open {
            self.set_step_status(*index, status, detail.clone());
        }
        !open.is_empty()
    }

    fn elapsed_ms(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

fn bounded_detail(value: &str) -> String {
    value.chars().take(MAX_DETAIL_CHARS).collect()
}

/// A short vocabulary word such as `in-scope` or `remote`, never prose.
fn host_token(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_HOST_TOKEN_CHARS
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::prelude::Uuid;
    use serde_json::json;

    fn tool_proposed(tool_call_id: &str, tool_name: &str) -> StreamingEvent {
        StreamingEvent::ToolCallProposed {
            message_id: Uuid::nil(),
            content_index: 0,
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.to_string(),
            input: None,
        }
    }

    fn tool_update(tool_call_id: &str, status: ToolCallStatus) -> StreamingEvent {
        StreamingEvent::ToolCallUpdate {
            message_id: Uuid::nil(),
            content_index: 0,
            tool_call_id: tool_call_id.to_string(),
            tool_name: "search_web".to_string(),
            input: None,
            status,
            progress_message: Some("SHOULD-NOT-LEAK".to_string()),
            progress: None,
            total: None,
            output: Some(json!({ "text": "SHOULD-NOT-LEAK" })),
        }
    }

    fn text_delta(new_text: &str) -> StreamingEvent {
        StreamingEvent::TextDelta {
            message_id: Uuid::nil(),
            content_index: 0,
            new_text: new_text.to_string(),
        }
    }

    fn message_completed() -> StreamingEvent {
        StreamingEvent::AssistantMessageCompleted {
            message_id: Uuid::nil(),
            content: Vec::new(),
            message: serde_json::from_value(json!({
                "id": Uuid::nil(),
                "chat_id": Uuid::nil(),
                "role": "assistant",
                "content": [],
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
                "is_message_in_active_thread": true,
                "input_files_ids": [],
                "files": [],
            }))
            .unwrap(),
        }
    }

    #[test]
    fn tool_calls_and_answer_become_ordered_steps() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        assert_eq!(
            collector.apply(&tool_proposed("call_1", "search_web")),
            Some(TraceChange::Structural)
        );
        assert_eq!(
            collector.apply(&tool_update("call_1", ToolCallStatus::InProgress)),
            Some(TraceChange::Progress)
        );
        assert_eq!(
            collector.apply(&tool_update("call_1", ToolCallStatus::Success)),
            Some(TraceChange::Structural)
        );
        assert_eq!(
            collector.apply(&text_delta("SHOULD-NOT-LEAK")),
            Some(TraceChange::Structural)
        );
        assert_eq!(collector.apply(&text_delta("more")), None);
        collector.finish();

        let trace = collector.snapshot();
        let serialized = serde_json::to_string(&trace).unwrap();
        assert!(!serialized.contains("SHOULD-NOT-LEAK"));
        assert_eq!(trace.steps.len(), 2);
        assert_eq!(trace.steps[0].sequence, 0);
        assert_eq!(trace.steps[0].id, "search_web");
        assert_eq!(trace.steps[0].status, DelegationTraceStepStatus::Ok);
        assert_eq!(trace.steps[1].sequence, 1);
        assert_eq!(trace.steps[1].id, "answer");
        assert_eq!(trace.steps[1].status, DelegationTraceStepStatus::Degraded);
        assert!(trace.total_duration_ms.is_some());
    }

    /// A delegate that says what it is about to do streams that text before
    /// the tool call it announces.
    #[test]
    fn text_preceding_a_tool_call_does_not_become_the_answer_step() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        collector.apply(&text_delta("Let me look that up."));
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(
            collector.apply(&tool_proposed("call_1", "search_web")),
            Some(TraceChange::Structural)
        );
        collector.apply(&tool_update("call_1", ToolCallStatus::Success));
        assert_eq!(
            collector.apply(&text_delta("forty-two")),
            Some(TraceChange::Structural)
        );
        collector.apply(&message_completed());
        collector.finish();

        let trace = collector.snapshot();
        assert_eq!(trace.steps.len(), 2);
        assert_eq!(trace.steps[0].sequence, 0);
        assert_eq!(trace.steps[0].id, "search_web");
        assert_eq!(trace.steps[1].sequence, 1);
        assert_eq!(trace.steps[1].id, "answer");
        assert_eq!(trace.steps[1].status, DelegationTraceStepStatus::Ok);
        // The answer is timed from the text that produced it, so it cannot
        // still be anchored on the announcement.
        assert!(trace.steps[1].started_at_offset_ms.unwrap() >= 20);
    }

    #[test]
    fn text_between_tool_calls_keeps_the_answer_last() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        collector.apply(&text_delta("first, a search"));
        collector.apply(&tool_proposed("call_1", "search_web"));
        collector.apply(&tool_update("call_1", ToolCallStatus::Success));
        collector.apply(&text_delta("now the page itself"));
        collector.apply(&tool_proposed("call_2", "fetch_page"));
        collector.apply(&tool_update("call_2", ToolCallStatus::Success));
        collector.apply(&text_delta("forty-two"));
        collector.apply(&message_completed());
        collector.finish();

        let trace = collector.snapshot();
        let ids: Vec<&str> = trace.steps.iter().map(|step| step.id.as_str()).collect();
        assert_eq!(ids, ["search_web", "fetch_page", "answer"]);
        for (index, step) in trace.steps.iter().enumerate() {
            assert_eq!(step.sequence as usize, index);
            assert_eq!(step.status, DelegationTraceStepStatus::Ok);
        }
    }

    #[test]
    fn unfinished_steps_settle_and_errors_carry_the_discriminant() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        collector.apply(&tool_proposed("call_1", "search_web"));
        collector.apply(&StreamingEvent::Error {
            error: Some(json!({ "error_type": "internal_error" })),
        });
        collector.finish();

        let trace = collector.snapshot();
        assert_eq!(trace.steps[0].status, DelegationTraceStepStatus::Error);
        assert_eq!(trace.steps[0].detail.as_deref(), Some("internal_error"));
    }

    #[test]
    fn steps_are_capped_and_sequences_stay_dense() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        for index in 0..(MAX_STEPS + 5) {
            collector.apply(&tool_proposed(&format!("call_{index}"), "search_web"));
        }
        collector.apply(&tool_update(
            &format!("call_{}", MAX_STEPS + 1),
            ToolCallStatus::Success,
        ));

        let trace = collector.snapshot();
        assert_eq!(trace.steps.len(), MAX_STEPS);
        for (index, step) in trace.steps.iter().enumerate() {
            assert_eq!(step.sequence as usize, index);
        }
    }

    fn granted_read(tool_call_id: &str, status: ToolCallStatus, output: Value) -> StreamingEvent {
        StreamingEvent::ToolCallUpdate {
            message_id: Uuid::nil(),
            content_index: 0,
            tool_call_id: tool_call_id.to_string(),
            tool_name: "read_document_blocks".to_string(),
            input: Some(json!({"snapshot": "SHOULD-NOT-LEAK", "part": "intro", "limit": 3})),
            status,
            progress_message: None,
            progress: None,
            total: None,
            output: Some(output),
        }
    }

    fn reads() -> ClientReadFields {
        HashMap::from([(
            "read_document_blocks".to_string(),
            vec![vec!["part".to_string()], vec!["limit".to_string()]],
        )])
    }

    #[test]
    fn a_granted_read_reports_the_part_it_asked_for_and_its_freshness() {
        let mut collector =
            DelegationTraceCollector::new(Instant::now()).with_client_reads(reads());
        collector.apply(&tool_proposed("call_1", "read_document_blocks"));
        collector.apply(&granted_read(
            "call_1",
            ToolCallStatus::Success,
            json!({"status": "success", "result": {
                "text": "SHOULD-NOT-LEAK",
                "freshness": {
                    "context_ref": "SHOULD-NOT-LEAK",
                    "changes": "elsewhere",
                    "counts": {"own": 1, "local": 0, "remote": 2, "unknown": 0,
                               "SHOULD NOT LEAK": 1, "negative": -1},
                },
            }}),
        ));
        collector.apply(&tool_proposed("call_2", "search_web"));
        collector.apply(&tool_update("call_2", ToolCallStatus::Success));

        let trace = collector.snapshot();
        assert!(!serde_json::to_string(&trace).unwrap().contains("SHOULD"));
        assert_eq!(trace.steps[0].status, DelegationTraceStepStatus::Ok);
        assert_eq!(
            trace.steps[0].detail.as_deref(),
            Some("intro, 3 · changes: elsewhere")
        );
        assert_eq!(
            trace.steps[0].counts,
            Some(BTreeMap::from([
                ("local".to_string(), 0),
                ("own".to_string(), 1),
                ("remote".to_string(), 2),
                ("unknown".to_string(), 0),
            ]))
        );
        assert_eq!(trace.steps[1].detail, None);
        assert_eq!(trace.steps[1].counts, None);

        let mut without_freshness =
            DelegationTraceCollector::new(Instant::now()).with_client_reads(reads());
        without_freshness.apply(&tool_proposed("call_1", "read_document_blocks"));
        without_freshness.apply(&granted_read(
            "call_1",
            ToolCallStatus::Success,
            json!({"status": "success", "result": {"text": "SHOULD-NOT-LEAK"}}),
        ));
        let step = &without_freshness.snapshot().steps[0];
        assert_eq!(step.detail.as_deref(), Some("intro, 3"));
        assert_eq!(step.counts, None);
    }

    #[test]
    fn a_resumed_run_goes_on_from_the_step_its_park_left_open() {
        let mut parked = DelegationTraceCollector::new(Instant::now());
        parked.apply(&tool_proposed("call_1", "search_web"));
        parked.apply(&tool_update("call_1", ToolCallStatus::Success));
        parked.apply(&tool_proposed("call_2", "read_document_blocks"));
        parked.finish();
        let parked = serde_json::from_value::<DelegationTrace>(
            serde_json::to_value(parked.snapshot()).unwrap(),
        )
        .unwrap();
        assert_eq!(parked.steps[1].status, DelegationTraceStepStatus::Degraded);

        let mut resumed = DelegationTraceCollector::resumed(parked).with_client_reads(reads());
        resumed.apply(&granted_read(
            "call_2",
            ToolCallStatus::InProgress,
            json!({"status": "in_progress"}),
        ));
        assert_eq!(
            resumed.snapshot().steps[1].status,
            DelegationTraceStepStatus::Running
        );
        resumed.apply(&granted_read(
            "call_2",
            ToolCallStatus::Success,
            json!({"status": "success", "result": {"freshness": {"changes": "none"}}}),
        ));
        resumed.apply(&text_delta("SHOULD-NOT-LEAK"));
        resumed.apply(&message_completed());
        resumed.finish();

        let trace = resumed.snapshot();
        let ids: Vec<&str> = trace.steps.iter().map(|step| step.id.as_str()).collect();
        assert_eq!(ids, ["search_web", "read_document_blocks", "answer"]);
        for (index, step) in trace.steps.iter().enumerate() {
            assert_eq!(step.sequence as usize, index);
            assert_eq!(step.status, DelegationTraceStepStatus::Ok);
        }
        assert_eq!(
            trace.steps[1].detail.as_deref(),
            Some("intro, 3 · changes: none")
        );
        assert!(trace.total_duration_ms.is_some());
    }

    #[test]
    fn serialized_step_matches_the_sidecar_shape() {
        let mut collector = DelegationTraceCollector::new(Instant::now());
        collector.apply(&tool_proposed("call_1", "search_web"));
        let value = serde_json::to_value(collector.snapshot()).unwrap();
        let step = &value["steps"][0];
        assert_eq!(step["sequence"], 0);
        assert_eq!(step["id"], "search_web");
        assert_eq!(step["status"], "running");
        assert!(step["startedAtOffsetMs"].is_number());
        assert!(step.get("durationMs").is_none());
        assert!(step.get("detail").is_none());
        assert!(step.get("counts").is_none());
        assert!(step.get("parentSequence").is_none());
        assert!(value.get("totalDurationMs").is_none());
    }
}
