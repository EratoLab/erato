//! Card-only controls; Teams cannot replace a message with mixed text/card
//! content. Opaque action tokens are resolved and claimed by the host.

use super::cards;
use super::host::{ActionKind, RequestState, TeamsRequest};
use super::render;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const ACTION: &str = "erato_response_control";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlCommand {
    Stop,
    Retry,
    Edit,
}

#[derive(Debug, Deserialize)]
pub struct Submit {
    action: String,
    pub request_id: Uuid,
    pub command: ControlCommand,
    pub token: Option<Uuid>,
    pub message_id: Option<Uuid>,
}

impl Submit {
    pub fn from_value(value: &Value) -> Option<Self> {
        let submit: Self = serde_json::from_value(value.clone()).ok()?;
        (submit.action == ACTION).then_some(submit)
    }
}

pub fn should_show(request: &TeamsRequest) -> bool {
    if request.pending_edit.is_some() {
        return true;
    }
    match request.state {
        RequestState::Preparing | RequestState::Running => !request.native_stop_available,
        RequestState::Completed => false,
        RequestState::Stopping | RequestState::Stopped | RequestState::Failed => true,
    }
}

pub fn activity(request: &TeamsRequest) -> Value {
    let mut actions = Vec::new();
    let mut body = Vec::new();
    let text = if request.running() {
        if request.state == RequestState::Stopping {
            "Stopping…"
        } else {
            super::streaming::WORKING_STATUS
        }
    } else if request.pending_edit.is_some() {
        "Your question was edited. Regenerate the answer using the updated question?"
    } else if request.state == RequestState::Stopped {
        "Stopped."
    } else if request.state == RequestState::Failed {
        "The response could not be completed."
    } else {
        "Finished."
    };
    body.push(json!({"type":"TextBlock", "text":text, "wrap":true}));
    if request.state == RequestState::Running
        && !request.native_stop_available
        && let Some(message_id) = request.assistant_message_id
    {
        actions.push(json!({"type":"Action.Submit", "title":"Stop", "data":{
            "action":ACTION, "command":ControlCommand::Stop, "request_id":request.id, "message_id":message_id
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
        if let (Some(token), Some(kind)) = (request.action_token, request.action_kind) {
            let (title, command) = match kind {
                ActionKind::Edit => ("Regenerate edited question", ControlCommand::Edit),
                ActionKind::Retry => ("Retry", ControlCommand::Retry),
            };
            actions.push(json!({"type":"Action.Submit", "title":title, "data":{
                "action":ACTION, "command":command, "request_id":request.id, "token":token
            }}));
        } else if matches!(request.state, RequestState::Stopped | RequestState::Failed)
            && request.tools_started
        {
            body.push(json!({"type":"TextBlock", "text":"This request involved tools. Send a new instruction to continue without automatically repeating their work.", "wrap":true, "isSubtle":true}));
        } else if request.state == RequestState::Failed {
            body.push(json!({"type":"TextBlock", "text":"Send a new message to continue.", "wrap":true, "isSubtle":true}));
        }
    }
    render::card_message(cards::adaptive_card(body, actions), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TeamsRequest {
        let now = chrono::Utc::now().fixed_offset();
        TeamsRequest {
            id: Uuid::new_v4(),
            conversation_id: "conversation".into(),
            source_activity_id: "question".into(),
            user_id: Uuid::new_v4(),
            chat_id: Uuid::new_v4(),
            user_message_id: Some(Uuid::new_v4()),
            assistant_message_id: Some(Uuid::new_v4()),
            control_activity_id: None,
            state: RequestState::Running,
            tools_started: false,
            native_stop_available: true,
            pending_edit: None,
            last_edit_at: None,
            action_token: None,
            action_kind: None,
            action_expires_at: None,
            run_id: Uuid::new_v4(),
            claimed_action_token: None,
            controls_version: 0,
            controls_lease_owner: None,
            controls_lease_until: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn native_stream_uses_its_own_stop_then_offers_retry_or_custom_fallback_controls() {
        let mut request = request();
        assert!(
            !should_show(&request),
            "no duplicate Stop card during native streaming"
        );
        request.pending_edit = Some("Edited question".into());
        assert!(should_show(&request), "retain the pending-edit explanation");
        assert!(
            activity(&request)["attachments"][0]["content"]["actions"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        request.pending_edit = None;
        request.native_stop_available = false;
        assert!(should_show(&request));
        assert_eq!(
            activity(&request)["attachments"][0]["content"]["actions"][0]["title"],
            "Stop"
        );
        request.state = RequestState::Stopping;
        assert!(
            activity(&request)["attachments"][0]["content"]["actions"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        request.state = RequestState::Stopped;
        request.native_stop_available = true;
        request.action_kind = Some(ActionKind::Retry);
        request.action_token = Some(Uuid::new_v4());
        assert!(should_show(&request), "native Stop still gets Erato Retry");
        assert_eq!(
            activity(&request)["attachments"][0]["content"]["actions"][0]["title"],
            "Retry"
        );
        request.state = RequestState::Completed;
        request.action_token = None;
        assert!(!should_show(&request));
    }

    #[test]
    fn card_data_round_trips_through_the_submit_parser() {
        let mut request = request();
        request.state = RequestState::Stopped;
        request.action_kind = Some(ActionKind::Edit);
        request.action_token = Some(Uuid::new_v4());
        request.pending_edit = Some("Edited question".into());
        let card = activity(&request);
        let submit =
            Submit::from_value(&card["attachments"][0]["content"]["actions"][0]["data"]).unwrap();
        assert_eq!(submit.command, ControlCommand::Edit);
        assert_eq!(submit.token, request.action_token);
        assert!(
            Submit::from_value(
                &json!({"action":ACTION, "command":"replay", "request_id":request.id})
            )
            .is_none(),
            "unknown commands are not controls"
        );
    }
}
