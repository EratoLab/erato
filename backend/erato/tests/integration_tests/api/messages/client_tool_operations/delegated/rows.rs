//! The hosts the delegated-task cases run against, one row per host context.
use super::{TIMEOUT_MS, WRITE_TOOL};
use erato::config::{
    ClientToolChildAccess, ClientToolConfig, ClientToolDurableConfig, ClientToolHostContext,
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

/// What a host brings to a delegated task: its binding, one read tool, the
/// turn the task is planned from and what its pane reports.
pub(super) struct HostRow {
    pub host: ClientToolHostContext,
    pub device: &'static str,
    pub identity: &'static str,
    /// Sent as `X-Erato-Platform` and required by the action facet.
    pub platform: &'static str,
    pub namespace: &'static str,
    pub read_tool: &'static str,
    pub read_parameters: Value,
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
}

impl HostRow {
    pub fn binding(&self) -> ExecutorBinding {
        ExecutorBinding {
            device_id: self.device.into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: self.host.as_str().into(),
                identity: self.identity.into(),
            }),
        }
    }

    pub fn read_config(&self, durable: bool) -> ClientToolConfig {
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
            durable: durable.then_some(ClientToolDurableConfig {
                host_context: self.host,
                result_schema: None,
                attempt_expiry_secs: 3600,
                claim_lease_secs: 120,
            }),
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
    /// place of the forged one.
    pub fn dispatched_input(&self) -> Value {
        let mut input = self.model_input.clone();
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
        platform: "fake",
        namespace: "fake",
        read_tool: "read_part",
        read_parameters: json!({"type": "object", "properties": {
            "context": {"type": "string"}, "part": {"type": "string"}}}),
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
    }
}

const SNAPSHOT: &str = "SNAPSHOT-TOKEN-7";

/// The overlay's Word read tool as it stands; ERMAIN-1003 adjusts the row to
/// what ships.
pub(super) fn word_document() -> HostRow {
    HostRow {
        host: ClientToolHostContext::WordDocument,
        device: "word-device",
        identity: "pane-session-1",
        platform: "word",
        namespace: "word",
        read_tool: "read_document_blocks",
        read_parameters: json!({"type": "object", "properties": {
            "snapshot": {"type": "string"},
            "documentIdentity": {"type": "string"},
            "target": {"type": "object"}},
            "required": ["snapshot"]}),
        requires_client_registration: true,
        model_input: json!({
            "snapshot": "forged",
            "documentIdentity": "document-1",
            "target": {"kind": "heading", "text": "Introduction"},
        }),
        turn_args: json!({}),
        context: Some(ContextVersion {
            arg: "document_snapshot",
            input: "snapshot",
            value: SNAPSHOT,
        }),
        part: ("$.target.text", "Introduction"),
        freshness: json!({
            "context_ref": SNAPSHOT,
            "capturedAt": "2026-10-20T10:00:00Z",
            "changes": "none",
            "counts": counts(),
        }),
        wait_note: wait_note(ClientToolHostContext::WordDocument),
    }
}

/// The overlay's Outlook availability read as it stands; ERMAIN-1006 adjusts
/// the row to what ships.
pub(super) fn outlook_mailbox() -> HostRow {
    HostRow {
        host: ClientToolHostContext::OutlookMailbox,
        device: "outlook-device",
        identity: "mailbox-digest-1",
        platform: "outlook",
        namespace: "outlook",
        read_tool: "fetch_availability",
        read_parameters: json!({"type": "object", "properties": {
            "lookahead_days": {"type": "integer", "minimum": 1, "maximum": 62},
            "attendees": {"type": "array", "items": {"type": "string"}, "maxItems": 15},
            "duration_minutes": {"type": "integer", "minimum": 5, "maximum": 1440}},
            "additionalProperties": false}),
        requires_client_registration: false,
        model_input: json!({"lookahead_days": 7, "duration_minutes": 30}),
        turn_args: json!({"now_iso": "2026-10-20T09:00:00+02:00", "timezone": "Europe/Berlin"}),
        context: None,
        part: ("$.lookahead_days", "7"),
        freshness: json!({
            "readAt": "2026-10-20T10:00:00Z",
            "changes": "none",
            "counts": counts(),
        }),
        wait_note: wait_note(ClientToolHostContext::OutlookMailbox),
    }
}
