//! Card-only controls; Teams cannot replace a message with mixed text/card
//! content. Opaque action tokens are resolved and claimed by the host.

use super::host::TeamsRequest;
use super::render;
use sea_orm::prelude::Uuid;
use serde::Deserialize;
use serde_json::{Value, json};

pub const ACTION: &str = "erato_response_control";

#[derive(Debug, Deserialize)]
pub struct Submit {
    action: String,
    pub request_id: Uuid,
    pub command: String,
    pub token: Option<Uuid>,
    pub message_id: Option<Uuid>,
}

impl Submit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == ACTION && matches!(submit.command.as_str(), "stop" | "retry" | "edit"))
            .then_some(submit)
    }
}

pub fn activity(request: &TeamsRequest) -> Value {
    let mut actions = Vec::new();
    let mut body = Vec::new();
    let text = if request.running() {
        if request.state == "stopping" {
            "Stopping…"
        } else {
            "Working on your request…"
        }
    } else if request.pending_edit.is_some() {
        "Your question was edited. Regenerate the answer using the updated question?"
    } else if request.state == "stopped" {
        "Stopped."
    } else if request.state == "failed" {
        "The response could not be completed."
    } else {
        "Finished."
    };
    body.push(json!({"type":"TextBlock", "text":text, "wrap":true}));
    if request.running()
        && let Some(message_id) = request.assistant_message_id
    {
        actions.push(json!({"type":"Action.Submit", "title":"Stop", "data":{
            "action":ACTION, "command":"stop", "request_id":request.id, "message_id":message_id
        }}));
    }
    if let Some(edited) = request.pending_edit.as_deref() {
        let preview: String = edited.chars().take(1200).collect();
        body.push(json!({"type":"TextBlock", "text":preview, "wrap":true}));
        body.push(json!({"type":"TextBlock", "text":"Regenerating starts a new answer and may run tools again. Original attachments are kept.", "wrap":true, "isSubtle":true}));
        if request.running() {
            body.push(json!({"type":"TextBlock", "text":"Stop the current response or wait for it to finish before regenerating.", "wrap":true}));
        }
    }
    if !request.running() {
        if let (Some(token), Some(kind)) = (request.action_token, request.action_kind.as_deref()) {
            actions.push(json!({"type":"Action.Submit", "title":if kind == "edit" {"Regenerate edited question"} else {"Retry"}, "data":{
                "action":ACTION, "command":kind, "request_id":request.id, "token":token
            }}));
        } else if matches!(request.state.as_str(), "stopped" | "failed") && request.tools_started {
            body.push(json!({"type":"TextBlock", "text":"This request involved tools. Send a new instruction to continue without automatically repeating their work.", "wrap":true, "isSubtle":true}));
        } else if request.state == "failed" {
            body.push(json!({"type":"TextBlock", "text":"Send a new message to continue.", "wrap":true, "isSubtle":true}));
        }
    }
    render::card_message(
        json!({"contentType":"application/vnd.microsoft.card.adaptive", "content":{
            "$schema":"http://adaptivecards.io/schemas/adaptive-card.json", "type":"AdaptiveCard", "version":"1.4", "body":body, "actions":actions
        }}),
        text,
    )
}
