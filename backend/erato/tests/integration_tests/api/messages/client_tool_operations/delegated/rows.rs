//! The hosts the delegated-task cases run against, one row per host context.
use super::{TIMEOUT_MS, WRITE_TOOL};
use erato::config::{
    ChildDispatch, ClientToolApprovalScope, ClientToolChildAccess, ClientToolConfig,
    ClientToolDurableConfig, ClientToolHostContext,
};
use erato::services::client_operations::{ExecutionRealm, ExecutorBinding, HostContext};
use serde_json::{Value, json};

/// The parent turn's action-facet argument that holds the context version,
/// and the read tool's input field the server fills with it.
pub(super) struct ContextVersion {
    pub arg: &'static str,
    pub input: &'static str,
    pub value: &'static str,
}

/// How a host's shell sends the row's binding on a parent-side request.
pub(super) enum Envelope {
    /// As `X-Erato-Executor`.
    Primary,
    /// In `X-Erato-Additional-Executors` beside this `X-Erato-Executor`, as an
    /// Office add-in sends the sidecar binding beside its own.
    Beside(ExecutorBinding),
    /// In `X-Erato-Additional-Executors` with no `X-Erato-Executor`, as the
    /// web app sends the sidecar binding.
    Alone,
}

/// What a host brings to a delegated task: its binding, one read tool, the
/// turn the task is planned from and what its pane reports.
pub(super) struct HostRow {
    pub host: ClientToolHostContext,
    pub device: &'static str,
    pub identity: &'static str,
    pub envelope: Envelope,
    /// Sent as `X-Erato-Platform` and required by the action facet.
    pub platform: &'static str,
    pub namespace: &'static str,
    pub read_tool: &'static str,
    pub read_parameters: Value,
    /// Input fields the pane fills from its own context (`child_host_inputs`).
    pub host_inputs: &'static [&'static str],
    pub requires_client_registration: bool,
    /// What the child's model sends, with a forged context version.
    pub model_input: Value,
    /// The parent turn's action-facet arguments besides the context version.
    pub turn_args: Value,
    pub context: Option<ContextVersion>,
    /// The receipt path naming the part a read asks for, and the part
    /// `model_input` asks for.
    pub part: (&'static str, &'static str),
    /// What the pane reports with a read.
    pub freshness: Value,
    /// The task result's note for a client task that asked for `async`.
    pub wait_note: &'static str,
    /// Whether the shell says, whenever it sends the row's binding, that the
    /// app behind it runs in strict mode (`X-Erato-Strict-Mode-Executors`).
    pub strict_mode: bool,
}

impl HostRow {
    pub fn binding(&self) -> ExecutorBinding {
        ExecutorBinding {
            device_id: self.device.into(),
            realm: match self.host {
                ClientToolHostContext::DesktopSidecar => ExecutionRealm::DesktopSidecar,
                ClientToolHostContext::OutlookMailbox | ClientToolHostContext::WordDocument => {
                    ExecutionRealm::OfficeAddin
                }
            },
            host_context: Some(HostContext {
                kind: self.host.as_str().into(),
                identity: self.identity.into(),
            }),
        }
    }

    /// The executor headers of a parent-side request that sends `executor`
    /// as the row's binding, the way the host's shell sends them. Without
    /// `executor` a shell that sends its binding beside another still sends
    /// that other one.
    pub fn executor_headers(
        &self,
        executor: Option<&ExecutorBinding>,
    ) -> Vec<(&'static str, String)> {
        let additional = executor.map(|binding| {
            (
                "X-Erato-Additional-Executors",
                serde_json::to_string(&[binding]).unwrap(),
            )
        });
        let strict_mode = executor.filter(|_| self.strict_mode).map(|binding| {
            (
                "X-Erato-Strict-Mode-Executors",
                serde_json::to_string(&[binding]).unwrap(),
            )
        });
        let headers: Vec<(&'static str, String)> = match &self.envelope {
            Envelope::Primary => executor
                .map(|binding| ("X-Erato-Executor", serde_json::to_string(binding).unwrap()))
                .into_iter()
                .collect(),
            Envelope::Beside(primary) => {
                std::iter::once(("X-Erato-Executor", serde_json::to_string(primary).unwrap()))
                    .chain(additional)
                    .collect()
            }
            Envelope::Alone => additional.into_iter().collect(),
        };
        headers.into_iter().chain(strict_mode).collect()
    }

    /// `durable` adds a `[durable]` table; `dispatch` is the tool's own
    /// `child_dispatch`.
    pub fn read_config(
        &self,
        durable: bool,
        dispatch: Option<ChildDispatch>,
        approval_scope: ClientToolApprovalScope,
    ) -> ClientToolConfig {
        ClientToolConfig {
            name: self.read_tool.into(),
            namespace: Some(self.namespace.into()),
            description: "Read part of what the pane holds".into(),
            parameters: self.read_parameters.to_string(),
            requires_client_registration: self.requires_client_registration,
            timeout_ms: Some(TIMEOUT_MS),
            child_access: ClientToolChildAccess::Read,
            host_context: Some(self.host),
            child_context_arg: self.context.as_ref().map(|context| context.arg.into()),
            child_context_input: self.context.as_ref().map(|context| context.input.into()),
            child_host_inputs: self.host_inputs.iter().map(|&field| field.into()).collect(),
            durable: durable.then_some(ClientToolDurableConfig {
                host_context: self.host,
                result_schema: None,
                attempt_expiry_secs: 3600,
                claim_lease_secs: 120,
            }),
            child_dispatch: dispatch,
            approval_scope,
            ..Default::default()
        }
    }

    pub fn qualified(&self) -> String {
        format!("{}/{}", self.namespace, self.read_tool)
    }

    pub fn context_ref(&self) -> Option<&'static str> {
        self.context.as_ref().map(|context| context.value)
    }

    /// `model_input` as the pane receives it: the grant's context version in
    /// place of the forged one, and none of the fields the pane fills.
    pub fn dispatched_input(&self) -> Value {
        let mut input = self.model_input.clone();
        if let Some(object) = input.as_object_mut() {
            for field in self.host_inputs {
                object.remove(*field);
            }
        }
        if let Some(context) = &self.context {
            input[context.input] = json!(context.value);
        }
        input
    }

    pub fn turn_action_args(&self) -> Value {
        let mut args = self.turn_args.clone();
        if let Some(context) = &self.context {
            args[context.arg] = json!(context.value);
        }
        args
    }

    pub fn pane_tools(&self) -> String {
        format!("{},{WRITE_TOOL}", self.read_tool)
    }

    pub fn child_pane_tools(&self) -> &'static str {
        self.read_tool
    }
}

fn counts() -> Value {
    json!({"own": 1, "local": 0, "remote": 0, "unknown": 0})
}

fn wait_note(host: ClientToolHostContext) -> &'static str {
    match host {
        ClientToolHostContext::WordDocument => "wait (uses the open document)",
        ClientToolHostContext::OutlookMailbox => "wait (uses the open mailbox)",
        ClientToolHostContext::DesktopSidecar => "wait (uses the Erato desktop app on this device)",
    }
}

const FAKE_CONTEXT: &str = "FAKE-CONTEXT-7";

/// A host that exists only in tests. Host contexts are compiled, so it borrows
/// a real kind and differs from that host in everything a host supplies. The
/// kind is a parameter so a row can sit on a context that outlives the pane.
pub(super) fn fake_host(host: ClientToolHostContext) -> HostRow {
    HostRow {
        host,
        device: "fake-device",
        identity: "fake-session-1",
        envelope: Envelope::Primary,
        platform: "fake",
        namespace: "fake",
        read_tool: "read_part",
        read_parameters: json!({"type": "object", "properties": {
            "context": {"type": "string"}, "part": {"type": "string"}}}),
        host_inputs: &[],
        requires_client_registration: false,
        model_input: json!({"context": "forged", "part": "intro"}),
        turn_args: json!({}),
        context: Some(ContextVersion {
            arg: "fake_context_version",
            input: "context",
            value: FAKE_CONTEXT,
        }),
        part: ("$.part", "intro"),
        freshness: json!({
            "context_ref": FAKE_CONTEXT,
            "capturedAt": "2026-10-20T10:00:00Z",
            "changes": "none",
            "counts": counts(),
        }),
        wait_note: wait_note(host),
        strict_mode: false,
    }
}

/// [`fake_host`] without a context version, like a live read: the grant and
/// the lineage carry no `context_ref`, and the pane reports `readAt`.
pub(super) fn fake_live_host(host: ClientToolHostContext) -> HostRow {
    HostRow {
        identity: "fake-live-session-1",
        read_parameters: json!({"type": "object", "properties": {
            "part": {"type": "string"}}}),
        model_input: json!({"part": "intro"}),
        context: None,
        freshness: json!({
            "readAt": "2026-10-20T10:00:00Z",
            "changes": "none",
            "counts": counts(),
        }),
        ..fake_host(host)
    }
}

const SNAPSHOT: &str = "SNAPSHOT-TOKEN-7";

/// The overlay's `word_read_document_blocks` parameters, verbatim from
/// `erato-action-facets.toml` (erato-subscription-content `main @ e10e960`):
/// complete pagination, `table_cell`, `target` and `section`.
const WORD_READ_PARAMETERS: &str = r##"{"type":"object","anyOf":[{"type":"object","properties":{"snapshot":{"type":"string","description":"The exact immutable document snapshot token supplied for this request."},"cursor":{"type":["string","null"],"description":"The preceding response's nextCursor; omit or use null for the first page."}},"required":["snapshot"],"additionalProperties":false},{"type":"object","properties":{"snapshot":{"type":"string"},"documentIdentity":{"type":"string"},"table_cell":{"type":"object","properties":{"nearbyText":{"type":"string","maxLength":256,"minLength":1},"header":{"type":"string","maxLength":256,"minLength":1},"rowLabel":{"type":"string","maxLength":256,"minLength":1},"text":{"type":"string","maxLength":256},"sourceRef":{"type":"string","maxLength":256,"minLength":1},"rowIndex":{"type":"integer","minimum":0},"cellIndex":{"type":"integer","minimum":0},"offset":{"type":"integer","minimum":0}},"minProperties":1,"additionalProperties":false}},"required":["snapshot","documentIdentity","table_cell"],"additionalProperties":false},{"type":"object","properties":{"snapshot":{"type":"string"},"documentIdentity":{"type":"string"},"target":{"anyOf":[{"$ref":"#/$defs/targetQuery"},{"type":"object","properties":{"queries":{"type":"array","minItems":1,"maxItems":16,"items":{"$ref":"#/$defs/targetQuery"}}},"required":["queries"],"additionalProperties":false}]},"include":{"type":"array","maxItems":7,"uniqueItems":true,"items":{"type":"string","enum":["text","formatting","table","media","structures","stories","sections"]}}},"required":["snapshot","documentIdentity","target"],"additionalProperties":false},{"type":"object","properties":{"snapshot":{"type":"string"},"documentIdentity":{"type":"string"},"section":{"type":"object","properties":{"ref":{"type":"string","minLength":1,"maxLength":256},"throughRef":{"type":"string","minLength":1,"maxLength":256},"cursor":{"type":["string","null"]}},"required":["ref"],"additionalProperties":false}},"required":["snapshot","documentIdentity","section"],"additionalProperties":false}],"$defs":{"targetQuery":{"type":"object","properties":{"kind":{"type":"string","minLength":1,"maxLength":256},"text":{"type":"string","minLength":1,"maxLength":256},"nearbyText":{"type":"string","minLength":1,"maxLength":256},"ref":{"type":"string","minLength":1,"maxLength":256},"throughRef":{"type":"string","minLength":1,"maxLength":256},"refs":{"type":"array","maxItems":16,"items":{"type":"string"},"minItems":1,"uniqueItems":true},"offset":{"type":"integer","minimum":0}},"required":[],"additionalProperties":false,"minProperties":1}}}"##;

/// The overlay's Word read tool as ERMAIN-1004 turns it on for tasks: the
/// server fills `snapshot` from the parent's `document_snapshot`, and the pane
/// fills `documentIdentity` from its own capture. Word's `sections` stays
/// empty until it sees a change, and the task result keeps only a non-empty
/// list, so the row reports a change elsewhere.
pub(super) fn word_document() -> HostRow {
    HostRow {
        host: ClientToolHostContext::WordDocument,
        device: "word-device",
        identity: "pane-session-1",
        envelope: Envelope::Primary,
        platform: "word",
        namespace: "word",
        read_tool: "read_document_blocks",
        read_parameters: serde_json::from_str(WORD_READ_PARAMETERS).unwrap(),
        host_inputs: &["documentIdentity"],
        requires_client_registration: true,
        model_input: json!({
            "snapshot": "forged",
            "documentIdentity": "guessed-document",
            "section": {"ref": "b3"},
        }),
        turn_args: json!({}),
        context: Some(ContextVersion {
            arg: "document_snapshot",
            input: "snapshot",
            value: SNAPSHOT,
        }),
        part: ("$.section.ref", "b3"),
        freshness: json!({
            "context_ref": SNAPSHOT,
            "capturedAt": "2026-10-20T10:00:00Z",
            "changes": "elsewhere",
            "counts": {"own": 0, "local": 1, "remote": 0, "unknown": 0},
            "sections": ["b7"],
        }),
        wait_note: wait_note(ClientToolHostContext::WordDocument),
        strict_mode: false,
    }
}

/// The overlay's Outlook availability read as it ships with ERMAIN-1006: no
/// context version, and a live read that reports all-zero counts. The overlay
/// keeps no receipt for it, so `part` serves only the cases that add one.
pub(super) fn outlook_mailbox() -> HostRow {
    HostRow {
        host: ClientToolHostContext::OutlookMailbox,
        device: "outlook-device",
        identity: "mailbox-digest-1",
        envelope: Envelope::Primary,
        platform: "outlook",
        namespace: "outlook",
        read_tool: "fetch_availability",
        read_parameters: json!({"type": "object", "properties": {
            "lookahead_days": {"type": "integer", "minimum": 1, "maximum": 62},
            "attendees": {"type": "array", "items": {"type": "string"}, "maxItems": 15},
            "duration_minutes": {"type": "integer", "minimum": 5, "maximum": 1440}},
            "additionalProperties": false}),
        host_inputs: &[],
        requires_client_registration: false,
        model_input: json!({"lookahead_days": 7, "duration_minutes": 30}),
        turn_args: json!({"now_iso": "2026-10-20T09:00:00+02:00", "timezone": "Europe/Berlin"}),
        context: None,
        part: ("$.lookahead_days", "7"),
        freshness: json!({
            "readAt": "2026-10-20T10:00:00Z",
            "changes": "none",
            "counts": {"own": 0, "local": 0, "remote": 0, "unknown": 0},
        }),
        wait_note: wait_note(ClientToolHostContext::OutlookMailbox),
        strict_mode: false,
    }
}

/// The fake Office binding the sidecar row's shell sends as its primary: the
/// Outlook add-in a sidecar binding travels beside.
pub(super) fn office_primary() -> ExecutorBinding {
    ExecutorBinding {
        device_id: "office-device".into(),
        realm: ExecutionRealm::OfficeAddin,
        host_context: Some(HostContext {
            kind: ClientToolHostContext::OutlookMailbox.as_str().into(),
            identity: "office-mailbox".into(),
        }),
    }
}

/// The overlay's `search_sidecar_index` as it ships with ERMAIN-1034. Its
/// binding travels in `X-Erato-Additional-Executors` beside an Office
/// primary, as the add-in shells send it.
pub(super) fn desktop_sidecar() -> HostRow {
    HostRow {
        host: ClientToolHostContext::DesktopSidecar,
        device: "sidecar-device",
        identity: "local",
        envelope: Envelope::Beside(office_primary()),
        // The action facet needs a platform; any value does.
        platform: "sidecar",
        namespace: "desktop",
        read_tool: "search_sidecar_index",
        read_parameters: json!({"type": "object", "properties": {
            "text": {"type": "string", "maxLength": 4096},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            "filters": {"type": "object", "properties": {
                "kind": {"type": "string", "enum": ["email", "file", "teams_message"]},
                "mailboxId": {"type": "string"},
                "dateFrom": {"type": "integer"},
                "dateTo": {"type": "integer"}},
                "additionalProperties": false}},
            "additionalProperties": false}),
        host_inputs: &[],
        requires_client_registration: true,
        model_input: json!({"text": "contract", "filters": {"dateFrom": 1719792000, "dateTo": 1727740800}}),
        turn_args: json!({}),
        context: None,
        part: ("$.text", "contract"),
        freshness: json!({
            "readAt": "2026-10-30T12:00:00Z",
            "changes": "unknown",
            "counts": {"own": 0, "local": 0, "remote": 0, "unknown": 0},
        }),
        wait_note: wait_note(ClientToolHostContext::DesktopSidecar),
        strict_mode: false,
    }
}

/// The sidecar row as the web app sends it: its binding alone in
/// `X-Erato-Additional-Executors`, with no `X-Erato-Executor`.
pub(super) fn desktop_sidecar_web() -> HostRow {
    HostRow {
        envelope: Envelope::Alone,
        ..desktop_sidecar()
    }
}
