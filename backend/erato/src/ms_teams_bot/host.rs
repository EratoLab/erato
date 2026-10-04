//! Erato glue: the only file of the Teams bot that touches Erato internals.
//!
//! Everything the handler needs from Erato goes through [`Host`] and comes
//! back as bot-level types ([`GenerationUpdate`], [`Completion`]), so the
//! protocol side stays independent and could move into its own crate.

mod progress;
mod sign_in;

use super::activity::ConversationKind;
use super::cards::{ApprovalChoice, ApprovalKind, PendingApprovalItem, PendingApprovalSet};
use super::graph::{GraphIdentity, SharedItem};
use super::streaming::WORKING_STATUS;
use crate::db::entity::prelude::{Chats, Messages, MsTeamsConversations, MsTeamsTokenExchanges};
use crate::db::entity::{ms_teams_conversations, ms_teams_token_exchanges, users};
use crate::models::message::{
    ContentPart, GenerationRequestContext, MessageSchema, ToolApprovalKind,
};
use crate::normalize_profile::IdTokenProfile;
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::{
    MeProfile, UserProfile, complete_user_profile,
};
use crate::server::api::v1beta::message_streaming::{
    ContinueStreamRequest, MessageSubmitRequest, StreamRouteError, ToolApprovalDecision,
    detached_generation_event_sink, start_continuation, start_message_submit,
};
use crate::services::background_tasks::{ClientStreamGuard, StreamingEvent, ToolCallStatus};
use crate::state::AppState;
use eyre::{Report, WrapErr, eyre};
use sea_orm::prelude::*;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveValue, QueryFilter, QuerySelect, TransactionTrait};
use serde_json::{Value, json};
use tokio::sync::{broadcast, mpsc};

/// Progress of one generation, as the handler renders it.
#[derive(Debug, Clone)]
pub enum GenerationUpdate {
    Started {
        chat_id: Uuid,
        message_id: Uuid,
    },
    /// The answer text so far (complete, not a delta).
    Text(String),
    /// User-facing phase or tool progress, without arguments or raw reasoning.
    Status(String),
    Completed(Completion),
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct Completion {
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub text: String,
    /// Text before the last tool step, kept separately from the answer.
    pub earlier_text: String,
    /// The open tool approvals the turn stopped on, answered together.
    pub approvals: Option<PendingApprovalSet>,
    /// The turn stopped on a client tool, which only the web app can run.
    pub needs_client: bool,
}

#[derive(Debug)]
pub enum StartError {
    /// The chat is already generating.
    Busy,
    /// Erato refused the request (validation, archived chat, foreign chat, …).
    Rejected(String),
    /// The decisions do not cover exactly the approvals that are open now.
    DecisionsMismatch,
    /// Every approval of the message was already decided.
    AlreadyDecided,
}

impl From<StreamRouteError> for StartError {
    fn from(error: StreamRouteError) -> Self {
        match error {
            StreamRouteError::GenerationRunning(_) => StartError::Busy,
            StreamRouteError::PlainText(_, message) => StartError::Rejected(message),
            StreamRouteError::DecisionsMismatch(_) => StartError::DecisionsMismatch,
            StreamRouteError::AlreadyContinued(_) => StartError::AlreadyDecided,
            StreamRouteError::CoveredByParent(_) => StartError::Rejected(
                "This approval is answered in the chat that started the task.".to_string(),
            ),
            StreamRouteError::NothingToReact(_) => {
                StartError::Rejected("The request could not be processed.".to_string())
            }
        }
    }
}

/// A user acting through Teams, with the same profile and policy view a web
/// request would have.
pub struct Session {
    me: MeProfile,
    policy: PolicyEngine,
    user_id: Uuid,
}

impl Session {
    pub fn user_id(&self) -> Uuid {
        self.user_id
    }
}

#[derive(Clone)]
pub struct Host {
    app_state: AppState,
}

impl Host {
    pub fn new(app_state: AppState) -> Self {
        Self { app_state }
    }

    /// Stop only the generation which produced this Teams stream. A later
    /// generation in the same chat must not be affected by a late Stop result.
    pub async fn stop_generation(&self, chat_id: Uuid, message_id: Uuid) {
        let tasks = &self.app_state.background_tasks;
        if let Some(generation) = tasks.active_generation(&chat_id).await
            && generation.message_id() == Some(message_id)
            && let Err(error) = tasks.abort_generation(&generation).await
        {
            tracing::warn!(%error, "Could not stop the Teams generation");
        }
    }

    pub fn sharepoint_enabled(&self) -> bool {
        self.app_state.config.integrations.sharepoint.enabled
    }

    pub fn max_upload_bytes(&self) -> usize {
        self.app_state
            .config
            .max_upload_size_bytes()
            .map(|value| value as usize)
            .unwrap_or(50 * 1024 * 1024)
    }

    pub async fn find_user(&self, entra_object_id: &str) -> Result<Option<users::Model>, Report> {
        crate::models::user::find_user_by_entra_object_id(&self.app_state.db, entra_object_id).await
    }

    /// Build the profile a web login would produce, from Graph instead of an
    /// ID token. The Graph token takes the place of oauth2-proxy's forwarded
    /// access token, so SharePoint and other Graph features work unchanged.
    pub async fn session(
        &self,
        user: &users::Model,
        identity: &GraphIdentity,
        groups: Vec<String>,
        graph_token: String,
        locale: Option<&str>,
        tenant_id: &str,
    ) -> Result<Session, Report> {
        let email = identity
            .email()
            .map(ToOwned::to_owned)
            .or_else(|| user.email.clone());
        let profile = IdTokenProfile {
            iss: user.issuer.clone(),
            sub: user.subject.clone(),
            email: email.clone(),
            name: identity.display_name.clone(),
            picture: None,
            preferred_language: identity.preferred_language.clone(),
            id_token_xms_pl: None,
            id_token_xms_tpl: None,
            groups: groups.clone(),
            organization_user_id: Some(identity.id.clone()),
            organization_group_ids: groups.clone(),
        };
        let user_profile = UserProfile::from_id_token_profile(profile, user.id.to_string());
        let user_profile = complete_user_profile(
            &self.app_state,
            user_profile,
            &user.id,
            locale.or(identity.preferred_language.as_deref()),
            None,
            None,
        )
        .await
        .map_err(|status| eyre!("failed to complete the user profile: {status}"))?;
        let id_token_claims = json!({
            "iss": user.issuer,
            "sub": user.subject,
            "oid": identity.id,
            "tid": tenant_id,
            "email": email,
            "name": identity.display_name,
            "groups": groups,
        });
        let me = MeProfile {
            profile: user_profile,
            // There is no OIDC token on this path; MCP servers configured to
            // forward the ID token get none for Teams requests.
            oidc_token: String::new(),
            id_token_claims,
            access_token: Some(graph_token),
        };
        let effective_config = self.app_state.effective_config().await;
        let policy = self
            .app_state
            .global_policy_engine
            .request_engine(&self.app_state.db, &effective_config)
            .await?;
        Ok(Session {
            me,
            policy,
            user_id: user.id,
        })
    }

    pub async fn upsert_conversation(
        &self,
        conversation_id: &str,
        kind: ConversationKind,
        user_id: Uuid,
        service_url: &str,
        ms_teams_user_id: &str,
    ) -> Result<ms_teams_conversations::Model, Report> {
        let row = ms_teams_conversations::ActiveModel {
            conversation_id: ActiveValue::Set(conversation_id.to_string()),
            conversation_type: ActiveValue::Set(kind.as_str().to_string()),
            user_id: ActiveValue::Set(user_id),
            service_url: ActiveValue::Set(service_url.to_string()),
            ms_teams_user_id: ActiveValue::Set(ms_teams_user_id.to_string()),
            ..Default::default()
        };
        Ok(MsTeamsConversations::insert(row)
            .on_conflict(
                OnConflict::columns([
                    ms_teams_conversations::Column::ConversationId,
                    ms_teams_conversations::Column::UserId,
                ])
                .update_columns([
                    ms_teams_conversations::Column::ServiceUrl,
                    ms_teams_conversations::Column::MsTeamsUserId,
                    ms_teams_conversations::Column::ConversationType,
                ])
                .to_owned(),
            )
            .exec_with_returning(&self.app_state.db)
            .await?)
    }

    pub async fn set_current_chat(
        &self,
        row: &ms_teams_conversations::Model,
        chat_id: Option<Uuid>,
    ) -> Result<(), Report> {
        let update = ms_teams_conversations::ActiveModel {
            id: ActiveValue::Unchanged(row.id),
            current_chat_id: ActiveValue::Set(chat_id),
            ..Default::default()
        };
        MsTeamsConversations::update(update)
            .exec(&self.app_state.db)
            .await?;
        Ok(())
    }

    /// The conversation's current chat, or a new one when there is none or it
    /// was archived or deleted in the meantime.
    pub async fn ensure_chat(
        &self,
        session: &Session,
        row: &ms_teams_conversations::Model,
        assistant_id: Option<Uuid>,
    ) -> Result<(Uuid, bool), Report> {
        // Fast path without a lock: the mapping already points at a usable chat.
        if let Some(chat_id) = row.current_chat_id
            && self
                .usable_chat(session, chat_id, &self.app_state.db)
                .await?
        {
            return Ok((chat_id, false));
        }

        // Activities of one conversation are handled concurrently. Serialise
        // chat creation on the mapping row so two first messages (or two
        // messages right after `/new`) end up in one chat: the second waits
        // here, then re-reads the winner's chat instead of creating its own.
        let txn = self.app_state.db.begin().await?;
        let locked = MsTeamsConversations::find_by_id(row.id)
            .lock_exclusive()
            .one(&txn)
            .await?
            .ok_or_else(|| eyre!("Teams conversation mapping disappeared"))?;
        if let Some(chat_id) = locked.current_chat_id
            && self.usable_chat(session, chat_id, &txn).await?
        {
            txn.commit().await?;
            return Ok((chat_id, false));
        }
        let assistant_id = match assistant_id {
            Some(assistant_id) => crate::models::assistant::get_assistant_by_id(
                &self.app_state.db,
                &session.policy,
                &session.me.to_subject(),
                assistant_id,
            )
            .await
            .map(|_| assistant_id)
            .inspect_err(|error| {
                tracing::warn!(%error, "Configured Teams assistant is not available to the user");
            })
            .ok(),
            None => None,
        };
        let (chat, _) = crate::models::chat::get_or_create_chat(
            &self.app_state.db,
            &session.policy,
            &session.me.to_subject(),
            None,
            &session.me.id,
            assistant_id.as_ref(),
            None,
            None,
            None,
            None,
            crate::models::chat::ChatCreatedVia::MsTeamsBot,
        )
        .await?;
        // The chat service commits on its own connection; the mapping update
        // joins the locking transaction, which releases the row on commit.
        MsTeamsConversations::update(ms_teams_conversations::ActiveModel {
            id: ActiveValue::Unchanged(locked.id),
            current_chat_id: ActiveValue::Set(Some(chat.id)),
            ..Default::default()
        })
        .exec(&txn)
        .await?;
        txn.commit().await?;
        Ok((chat.id, true))
    }

    /// Whether a mapped chat can keep receiving Teams messages.
    async fn usable_chat<C: sea_orm::ConnectionTrait>(
        &self,
        session: &Session,
        chat_id: Uuid,
        conn: &C,
    ) -> Result<bool, Report> {
        Ok(Chats::find_by_id(chat_id)
            .one(conn)
            .await?
            .is_some_and(|chat| chat.archived_at.is_none() && chat.owner_user_id == session.me.id))
    }

    /// Store bytes as a regular upload on the chat.
    pub async fn store_file(
        &self,
        session: &Session,
        chat_id: Uuid,
        filename: &str,
        content_type: Option<&str>,
        bytes: Vec<u8>,
    ) -> Result<Uuid, Report> {
        let content_type =
            crate::server::api::v1beta::effective_upload_content_type(filename, content_type);
        let file_path = Uuid::new_v4().to_string();
        let storage = self.app_state.default_file_storage_provider();
        let mut writer = storage
            .upload_file_writer(&file_path, content_type.as_deref())
            .await?;
        writer
            .write(bytes)
            .await
            .wrap_err("failed to write file data")?;
        writer.close().await.wrap_err("failed to write file data")?;
        let upload = crate::models::file_upload::create_file_upload(
            &self.app_state.db,
            &session.policy,
            &session.me.to_subject(),
            &chat_id,
            filename.to_string(),
            self.app_state.default_file_storage_provider_id(),
            file_path,
            None,
            None,
        )
        .await?;
        Ok(upload.id)
    }

    /// Link a SharePoint item to the chat, like the web file picker does.
    pub async fn link_sharepoint_file(
        &self,
        session: &Session,
        chat_id: Uuid,
        item: SharedItem,
    ) -> Result<Uuid, Report> {
        let upload = crate::models::file_upload::create_sharepoint_file_upload(
            &self.app_state.db,
            &session.policy,
            &session.me.to_subject(),
            Some(&chat_id),
            item.name,
            item.drive_id,
            item.item_id,
        )
        .await?;
        Ok(upload.id)
    }

    pub async fn submit(
        &self,
        session: &Session,
        chat_id: Uuid,
        text: String,
        file_ids: Vec<Uuid>,
    ) -> Result<mpsc::Receiver<GenerationUpdate>, StartError> {
        let previous_message_id =
            crate::models::message::get_active_thread_tip(&self.app_state.db, &chat_id)
                .await
                .map_err(|error| StartError::Rejected(error.to_string()))?
                .map(|message| message.id);
        let request =
            MessageSubmitRequest::for_integration(chat_id, previous_message_id, text, file_ids);
        let started = start_message_submit(
            &self.app_state,
            &session.policy,
            &session.me,
            teams_request_context(),
            request,
        )
        .await?;
        Ok(translate(
            started.chat_id,
            started.events,
            Some(started.client_stream_guard),
        ))
    }

    pub async fn continue_approval(
        &self,
        session: &Session,
        message_id: Uuid,
        decisions: Vec<(String, ApprovalChoice)>,
    ) -> Result<mpsc::Receiver<GenerationUpdate>, StartError> {
        let decisions = decisions
            .into_iter()
            .map(|(approval_id, choice)| {
                let decision = match choice {
                    ApprovalChoice::Approve => ToolApprovalDecision::Approve,
                    ApprovalChoice::Reject => ToolApprovalDecision::Reject,
                    ApprovalChoice::Withdraw => ToolApprovalDecision::Withdraw,
                };
                (approval_id, decision)
            })
            .collect();
        // Passed through as submitted: Erato checks that the set is exact.
        let request = ContinueStreamRequest::with_decisions(message_id, decisions);
        let started = start_continuation(
            &self.app_state,
            &session.policy,
            &session.me,
            request,
            detached_generation_event_sink(),
        )
        .await?;
        Ok(translate(started.chat_id, started.events, None))
    }

    pub async fn conversations_for_chat(
        &self,
        chat_id: Uuid,
    ) -> Result<Vec<ms_teams_conversations::Model>, Report> {
        Ok(MsTeamsConversations::find()
            .filter(ms_teams_conversations::Column::CurrentChatId.eq(chat_id))
            .all(&self.app_state.db)
            .await?)
    }

    /// The stored answer of a finished assistant message.
    pub async fn completion_for_message(
        &self,
        chat_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<Completion>, Report> {
        let Some(message) = Messages::find_by_id(message_id)
            .one(&self.app_state.db)
            .await?
            .filter(|message| message.chat_id == chat_id)
        else {
            return Ok(None);
        };
        let parsed = MessageSchema::validate(&message.raw_message)?;
        Ok(Some(completion_from_content(
            chat_id,
            message_id,
            &parsed.content,
        )))
    }

    /// The approvals a message of the session user's own chat is waiting on.
    pub async fn pending_approvals(
        &self,
        session: &Session,
        message_id: Uuid,
    ) -> Result<Option<PendingApprovalSet>, Report> {
        let Some(message) = Messages::find_by_id(message_id)
            .one(&self.app_state.db)
            .await?
        else {
            return Ok(None);
        };
        if !self
            .usable_chat(session, message.chat_id, &self.app_state.db)
            .await?
        {
            return Ok(None);
        }
        let parsed = MessageSchema::validate(&message.raw_message)?;
        Ok(completion_from_content(message.chat_id, message_id, &parsed.content).approvals)
    }

    /// Claim an SSO token exchange; `false` when another replica or client
    /// already processed the same exchange.
    pub async fn claim_token_exchange(&self, exchange_id: &str) -> Result<bool, Report> {
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(1);
        MsTeamsTokenExchanges::delete_many()
            .filter(ms_teams_token_exchanges::Column::CreatedAt.lt(cutoff))
            .exec(&self.app_state.db)
            .await?;
        let row = ms_teams_token_exchanges::ActiveModel {
            exchange_id: ActiveValue::Set(exchange_id.to_string()),
            ..Default::default()
        };
        let inserted = MsTeamsTokenExchanges::insert(row)
            .on_conflict(
                OnConflict::column(ms_teams_token_exchanges::Column::ExchangeId)
                    .do_nothing()
                    .to_owned(),
            )
            .exec_without_returning(&self.app_state.db)
            .await?;
        Ok(inserted > 0)
    }
}

fn teams_request_context() -> GenerationRequestContext {
    GenerationRequestContext {
        platform: Some(super::TEAMS_PLATFORM.to_string()),
        ..Default::default()
    }
}

/// Follow a generation's broadcast and forward it as [`GenerationUpdate`]s
/// until the stream ends. Holding `guard` tells the generation a client is
/// attached, exactly as an open SSE response does.
fn translate(
    chat_id: Uuid,
    mut events: broadcast::Receiver<StreamingEvent>,
    guard: Option<ClientStreamGuard>,
) -> mpsc::Receiver<GenerationUpdate> {
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let _guard = guard;
        let mut text = String::new();
        let mut text_index: Option<usize> = None;
        let mut tool_index: Option<usize> = None;
        let mut progress = progress::Progress::default();
        let mut announced_message = None;
        let mut last_status = None;
        loop {
            let event = events.recv().await;
            // Continuations can begin with deltas instead of a Started event.
            // Remember their exact message too, for the native Stop button.
            let message_id = match &event {
                Ok(
                    StreamingEvent::AssistantMessageStarted { message_id }
                    | StreamingEvent::TextDelta { message_id, .. }
                    | StreamingEvent::ReasoningDelta { message_id, .. }
                    | StreamingEvent::ToolCallProposed { message_id, .. }
                    | StreamingEvent::ToolCallUpdate { message_id, .. }
                    | StreamingEvent::ClientToolCall { message_id, .. },
                ) => Some(*message_id),
                _ => None,
            };
            if let Some(message_id) = message_id
                && announced_message != Some(message_id)
            {
                text.clear();
                text_index = None;
                tool_index = None;
                announced_message = Some(message_id);
                if tx
                    .send(GenerationUpdate::Started {
                        chat_id,
                        message_id,
                    })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            // A tool boundary separates earlier narration from the answer
            // that follows it. Late updates from an older parallel tool must
            // not erase newer answer text.
            if let Ok(
                StreamingEvent::ToolCallProposed { content_index, .. }
                | StreamingEvent::ToolCallUpdate { content_index, .. }
                | StreamingEvent::ClientToolCall { content_index, .. },
            ) = &event
                && tool_index.is_none_or(|index| *content_index > index)
            {
                tool_index = Some(*content_index);
                if text_index.is_some_and(|index| index < *content_index) {
                    text.clear();
                    text_index = None;
                    if tx
                        .send(GenerationUpdate::Text(String::new()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
            let update = match event {
                Ok(StreamingEvent::AssistantMessageStarted { .. }) => {
                    GenerationUpdate::Status(WORKING_STATUS.into())
                }
                Ok(StreamingEvent::ReasoningDelta { .. }) => GenerationUpdate::Status(
                    progress.current().unwrap_or_else(|| "Thinking…".into()),
                ),
                Ok(StreamingEvent::TextDelta {
                    content_index,
                    new_text,
                    ..
                }) => {
                    if tool_index.is_some_and(|index| content_index <= index) {
                        continue;
                    }
                    if text_index.is_some_and(|index| index != content_index) && !text.is_empty() {
                        text.push_str("\n\n");
                    }
                    text_index = Some(content_index);
                    text.push_str(&new_text);
                    GenerationUpdate::Text(text.clone())
                }
                Ok(StreamingEvent::ToolCallProposed {
                    tool_call_id,
                    tool_name,
                    ..
                }) => GenerationUpdate::Status(progress.tool(
                    tool_call_id,
                    &tool_name,
                    ToolCallStatus::Preparing,
                    None,
                    None,
                    None,
                )),
                Ok(StreamingEvent::ToolCallUpdate {
                    tool_call_id,
                    tool_name,
                    status,
                    progress_message,
                    progress: completed,
                    total,
                    ..
                }) => GenerationUpdate::Status(progress.tool(
                    tool_call_id,
                    &tool_name,
                    status,
                    progress_message.as_deref(),
                    completed,
                    total,
                )),
                Ok(StreamingEvent::ClientToolCall { .. }) => {
                    GenerationUpdate::Status("This step needs the Erato app…".into())
                }
                Ok(StreamingEvent::AssistantMessageCompleted {
                    message_id,
                    content,
                    ..
                }) => GenerationUpdate::Completed(completion_from_content(
                    chat_id, message_id, &content,
                )),
                Ok(StreamingEvent::Error { error }) => {
                    GenerationUpdate::Failed(error_message(error.as_ref()))
                }
                Ok(StreamingEvent::StreamEnd) => break,
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::debug!(skipped, "Teams bot lagged behind generation events");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };
            let active_tools = matches!(update, GenerationUpdate::Text(_))
                .then(|| progress.current())
                .flatten();
            if let GenerationUpdate::Status(status) = &update {
                if last_status.as_ref() == Some(status) {
                    continue;
                }
                last_status = Some(status.clone());
            } else {
                last_status = None;
            }
            if tx.send(update).await.is_err() {
                break;
            }
            if let Some(status) = active_tools
                && tx.send(GenerationUpdate::Status(status)).await.is_err()
            {
                break;
            }
        }
    });
    rx
}

fn completion_from_content(chat_id: Uuid, message_id: Uuid, content: &[ContentPart]) -> Completion {
    let (text, earlier_text) = answer_text(content);
    // A client tool runs on the user's device, never in Teams, so its approval
    // is left to the Erato app instead of a card whose approval could not run it.
    let client_tool_approval = matches!(
        content.last(),
        Some(ContentPart::ToolApprovalRequest(request))
            if request.kind == ToolApprovalKind::ClientTool
    );
    let approvals = match content.last() {
        Some(ContentPart::ToolApprovalRequest(request)) if !client_tool_approval => {
            Some(PendingApprovalSet {
                message_id: message_id.to_string(),
                kind: match request.kind {
                    ToolApprovalKind::McpTool | ToolApprovalKind::ClientTool => {
                        ApprovalKind::McpTool
                    }
                    ToolApprovalKind::DelegatedTask => ApprovalKind::DelegatedTask,
                    ToolApprovalKind::TaskPlan => ApprovalKind::TaskPlan,
                    ToolApprovalKind::ToolCallLimit => ApprovalKind::ToolCallLimit,
                },
                items: request
                    .approval_items()
                    .into_iter()
                    .map(|item| match item.child {
                        // A delegated task's item names the parent's delegation
                        // call; the decision is about the child's gated tool.
                        Some(child) => PendingApprovalItem {
                            approval_id: item.approval_id,
                            tool_name: child.tool_name,
                            input: child.input,
                        },
                        None => PendingApprovalItem {
                            approval_id: item.approval_id,
                            tool_name: item.tool_name,
                            input: item.input,
                        },
                    })
                    .collect(),
            })
            .filter(|set: &PendingApprovalSet| !set.items.is_empty())
        }
        _ => None,
    };
    Completion {
        chat_id,
        message_id,
        text,
        earlier_text,
        approvals,
        needs_client: client_tool_approval
            || matches!(content.last(), Some(ContentPart::ClientToolPending(_))),
    }
}

/// Keep all assistant text, but present text after the last tool step as the
/// answer. Earlier text is disclosed separately, without guessing from its
/// wording whether it is merely narration or contains useful information.
fn answer_text(content: &[ContentPart]) -> (String, String) {
    let boundary = content.iter().rposition(|part| {
        matches!(
            part,
            ContentPart::ToolUse(_)
                | ContentPart::ToolApprovalRequest(_)
                | ContentPart::ToolApproval(_)
                | ContentPart::ToolRejection(_)
                | ContentPart::ClientToolPending(_)
        )
    });
    let join = |parts: &[ContentPart]| {
        parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text(text) if !text.text.trim().is_empty() => Some(text.text.trim()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    if let Some(index) = boundary {
        let answer = join(&content[index + 1..]);
        if !answer.is_empty() {
            return (answer, join(&content[..index]));
        }
    }
    // An approval pause or a tool-only completion may have no trailing answer.
    // Keep the existing text visible instead of hiding the only explanation.
    (join(content), String::new())
}

fn error_message(error: Option<&Value>) -> String {
    error
        .and_then(|error| {
            ["error_description", "message", "error"]
                .iter()
                .find_map(|key| error.get(*key).and_then(Value::as_str))
        })
        .unwrap_or("The answer could not be generated.")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{ContentPartToolApprovalRequest, ToolApprovalAnnotations};

    #[tokio::test]
    async fn translates_thinking_and_tool_progress_including_continuations() {
        let chat_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let (sender, receiver) = broadcast::channel(16);
        let mut updates = translate(chat_id, receiver, None);
        // A continuation need not repeat AssistantMessageStarted.
        sender
            .send(StreamingEvent::ReasoningDelta {
                message_id,
                content_index: 0,
                new_text: "private reasoning text".into(),
            })
            .unwrap();
        sender
            .send(StreamingEvent::ToolCallUpdate {
                message_id,
                content_index: 1,
                tool_call_id: "call".into(),
                tool_name: "read_file".into(),
                input: None,
                status: ToolCallStatus::InProgress,
                progress_message: Some("Reading page".into()),
                progress: Some(2.0),
                total: Some(3.0),
                output: None,
            })
            .unwrap();
        sender
            .send(StreamingEvent::ToolCallUpdate {
                message_id,
                content_index: 1,
                tool_call_id: "call".into(),
                tool_name: "read_file".into(),
                input: None,
                status: ToolCallStatus::Success,
                progress_message: None,
                progress: None,
                total: None,
                output: None,
            })
            .unwrap();
        sender
            .send(StreamingEvent::TextDelta {
                message_id,
                content_index: 2,
                new_text: "Answer".into(),
            })
            .unwrap();
        sender.send(StreamingEvent::StreamEnd).unwrap();
        assert!(
            matches!(updates.recv().await, Some(GenerationUpdate::Started { chat_id: c, message_id: m }) if c == chat_id && m == message_id)
        );
        assert!(
            matches!(updates.recv().await, Some(GenerationUpdate::Status(s)) if s == "Thinking…")
        );
        assert!(
            matches!(updates.recv().await, Some(GenerationUpdate::Status(s)) if s.contains("Reading page (2/3)"))
        );
        assert!(
            matches!(updates.recv().await, Some(GenerationUpdate::Status(s)) if s.contains("Finished read_file"))
        );
        assert!(matches!(updates.recv().await, Some(GenerationUpdate::Text(s)) if s == "Answer"));
        assert!(updates.recv().await.is_none());
    }

    fn approval(kind: ToolApprovalKind) -> ContentPart {
        ContentPart::ToolApprovalRequest(ContentPartToolApprovalRequest {
            tool_call_id: "call-1".to_string(),
            tool_name: "search_sidecar_index".to_string(),
            mcp_server_id: "desktop".to_string(),
            input: json!({}),
            annotations: ToolApprovalAnnotations {
                read_only_hint: false,
                destructive_hint: true,
                idempotent_hint: false,
                open_world_hint: true,
            },
            preset: String::new(),
            allow_always: true,
            requested_at: String::new(),
            kind,
            approvals: Vec::new(),
            pending_tool_calls: Vec::new(),
        })
    }

    #[test]
    fn a_client_tool_approval_is_left_to_the_erato_app() {
        let completion = completion_from_content(
            Uuid::nil(),
            Uuid::nil(),
            &[approval(ToolApprovalKind::ClientTool)],
        );
        assert!(completion.approvals.is_none());
        assert!(completion.needs_client);
    }

    #[test]
    fn an_mcp_tool_approval_still_gets_a_card() {
        let completion = completion_from_content(
            Uuid::nil(),
            Uuid::nil(),
            &[approval(ToolApprovalKind::McpTool)],
        );
        let approvals = completion.approvals.expect("an approval card");
        assert_eq!(approvals.kind, ApprovalKind::McpTool);
        assert_eq!(approvals.items.len(), 1);
        assert!(!completion.needs_client);
    }

    #[test]
    fn answer_separates_earlier_text_without_discarding_it() {
        use crate::models::message::{ContentPartText, ToolUse};
        let text = |text: &str| ContentPart::Text(ContentPartText { text: text.into() });
        let tool = ContentPart::ToolUse(ToolUse::default());
        assert_eq!(
            answer_text(&[text("Plain answer")]),
            ("Plain answer".into(), "".into())
        );
        assert_eq!(
            answer_text(&[
                text("I will check."),
                tool.clone(),
                text("Useful intermediate finding"),
                tool.clone(),
                text("Final answer"),
                text("More answer")
            ]),
            (
                "Final answer\n\nMore answer".into(),
                "I will check.\n\nUseful intermediate finding".into()
            )
        );
        assert_eq!(
            answer_text(&[text("Explanation before a tool-only ending"), tool]),
            ("Explanation before a tool-only ending".into(), "".into())
        );
        assert_eq!(
            answer_text(&[
                text("Please approve this action"),
                approval(ToolApprovalKind::McpTool)
            ]),
            ("Please approve this action".into(), "".into())
        );
    }

    #[tokio::test]
    async fn tool_boundary_replaces_narration_and_late_progress_keeps_the_answer() {
        let message_id = Uuid::new_v4();
        let (sender, receiver) = broadcast::channel(16);
        let mut updates = translate(Uuid::new_v4(), receiver, None);
        let text = |index, text: &str| StreamingEvent::TextDelta {
            message_id,
            content_index: index,
            new_text: text.into(),
        };
        sender.send(text(0, "I am checking.")).unwrap();
        sender
            .send(StreamingEvent::ToolCallProposed {
                message_id,
                content_index: 1,
                tool_call_id: "read".into(),
                tool_name: "read_file".into(),
                input: None,
            })
            .unwrap();
        sender.send(text(2, "The result")).unwrap();
        sender
            .send(StreamingEvent::ToolCallUpdate {
                message_id,
                content_index: 1,
                tool_call_id: "read".into(),
                tool_name: "read_file".into(),
                status: ToolCallStatus::Success,
                input: None,
                output: None,
                progress_message: None,
                progress: None,
                total: None,
            })
            .unwrap();
        sender.send(text(2, " is ready.")).unwrap();
        sender.send(StreamingEvent::StreamEnd).unwrap();
        let mut texts = Vec::new();
        while let Some(update) = updates.recv().await {
            if let GenerationUpdate::Text(text) = update {
                texts.push(text);
            }
        }
        assert_eq!(
            texts,
            ["I am checking.", "", "The result", "The result is ready."]
        );
    }
}
