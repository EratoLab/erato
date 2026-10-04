//! Durable request routing and one-use controls. Card payloads never supply
//! chat/message IDs or edited text; those are resolved from this store.

use super::*;
use crate::db::entity::ms_teams_requests;
pub use crate::db::entity::ms_teams_requests::{ActionKind, RequestState};
use crate::models::message::MessageRole;
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::server::api::v1beta::message_streaming::{
    EditMessageRequest, RegenerateMessageRequest, STALE_REVISION_MESSAGE, start_edit,
    start_regeneration,
};
use sea_orm::{DbBackend, FromQueryResult, Statement};

pub type TeamsRequest = ms_teams_requests::Model;

const ACTION_TTL_HOURS: i32 = 24;
/// Settled rows older than this only served redelivery and expired actions.
const REQUEST_RETENTION_HOURS: i32 = 48;
/// Outlives one bounded control delivery, so a live holder keeps its lease.
pub const CONTROLS_LEASE_SECS: f64 = 60.0;

impl TeamsRequest {
    pub fn running(&self) -> bool {
        self.state.is_active()
    }
}

fn statement(id: &'static str, sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    named_statement_from_sql_and_values(DbBackend::Postgres, id, sql, values)
}

impl Host {
    async fn request_query(
        &self,
        id: &'static str,
        sql: &str,
        values: Vec<sea_orm::Value>,
    ) -> Result<Option<TeamsRequest>, Report> {
        Ok(TeamsRequest::find_by_statement(statement(id, sql, values))
            .one(&self.app_state.db)
            .await?)
    }

    /// Duplicate delivery of the same Teams activity must not generate again.
    /// The new row becomes the latest question, so pruning older settled rows
    /// keeps editing the latest question available.
    pub async fn remember_request(
        &self,
        session: &Session,
        conversation: &str,
        activity_id: &str,
        chat_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.app_state
            .db
            .execute_raw(statement(
                "ms_teams_requests.prune",
                "DELETE FROM ms_teams_requests WHERE user_id=$1 AND conversation_id=$2
                 AND state IN ('stopped','failed','completed')
                 AND created_at < now() - make_interval(hours => $3)",
                vec![
                    session.user_id.into(),
                    conversation.into(),
                    REQUEST_RETENTION_HOURS.into(),
                ],
            ))
            .await?;
        self.request_query(
            "ms_teams_requests.remember",
            "INSERT INTO ms_teams_requests (conversation_id, source_activity_id, user_id, chat_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
            vec![
                conversation.into(),
                activity_id.into(),
                session.user_id.into(),
                chat_id.into(),
            ],
        )
        .await
    }

    pub async fn request_for_user(
        &self,
        session: &Session,
        conversation: &str,
        request_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.for_user",
            "SELECT * FROM ms_teams_requests WHERE id=$1 AND user_id=$2 AND conversation_id=$3",
            vec![
                request_id.into(),
                session.user_id.into(),
                conversation.into(),
            ],
        )
        .await
    }

    pub async fn request_for_activity(
        &self,
        session: &Session,
        conversation: &str,
        activity_id: &str,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.for_activity",
            "SELECT * FROM ms_teams_requests WHERE user_id=$1 AND conversation_id=$2 AND source_activity_id=$3",
            vec![session.user_id.into(), conversation.into(), activity_id.into()],
        )
        .await
    }

    pub async fn request_for_assistant(
        &self,
        message_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.for_assistant",
            "SELECT * FROM ms_teams_requests WHERE assistant_message_id=$1",
            vec![message_id.into()],
        )
        .await
    }

    /// The request whose generation runs in this chat now, when this user
    /// started it from this conversation. Newer failed or rejected requests
    /// must not hide it.
    pub async fn active_request(
        &self,
        session: &Session,
        conversation: &str,
        chat_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        let Some(message_id) = self
            .app_state
            .background_tasks
            .active_generation(&chat_id)
            .await
            .and_then(|generation| generation.message_id())
        else {
            return Ok(None);
        };
        self.request_query(
            "ms_teams_requests.active",
            "SELECT * FROM ms_teams_requests WHERE assistant_message_id=$1 AND user_id=$2 AND conversation_id=$3",
            vec![message_id.into(), session.user_id.into(), conversation.into()],
        )
        .await
    }

    pub async fn generation_active(&self, chat_id: Uuid) -> bool {
        self.app_state
            .background_tasks
            .active_generation(&chat_id)
            .await
            .is_some()
    }

    pub async fn request_snapshot(&self, request_id: Uuid) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.snapshot",
            "SELECT * FROM ms_teams_requests WHERE id=$1",
            vec![request_id.into()],
        )
        .await
    }

    /// Record what one generation update means for its request. Bookkeeping
    /// never ends delivery: failures are logged, and a request that a newer
    /// run took over is no longer written.
    pub async fn track_update(
        &self,
        request: &mut Option<TeamsRequest>,
        update: &GenerationUpdate,
        native_stop_available: bool,
    ) {
        let Some(current) = request.as_ref() else {
            return;
        };
        let result = match update {
            GenerationUpdate::UserMessageSaved(message_id) => {
                self.request_query(
                    "ms_teams_requests.user_message",
                    "UPDATE ms_teams_requests SET user_message_id=$2 WHERE id=$1 AND run_id=$3 RETURNING *",
                    vec![current.id.into(), (*message_id).into(), current.run_id.into()],
                )
                .await
            }
            GenerationUpdate::ToolStarted => {
                self.request_query(
                    "ms_teams_requests.tool_started",
                    "UPDATE ms_teams_requests SET tools_started=true WHERE id=$1 AND run_id=$2 RETURNING *",
                    vec![current.id.into(), current.run_id.into()],
                )
                .await
            }
            GenerationUpdate::Started { message_id, .. } => {
                self.request_query(
                    "ms_teams_requests.started",
                    "UPDATE ms_teams_requests SET assistant_message_id=$2, state='running', native_stop_available=$4
                     WHERE id=$1 AND run_id=$3 RETURNING *",
                    vec![
                        current.id.into(),
                        (*message_id).into(),
                        current.run_id.into(),
                        native_stop_available.into(),
                    ],
                )
                .await
            }
            _ => return,
        };
        apply_tracked(request, result);
    }

    /// Persist the delivery mode so edit callbacks on any replica can avoid
    /// adding a second Stop button beside Teams' native one.
    pub async fn track_native_stop(&self, request: &mut Option<TeamsRequest>, available: bool) {
        let Some(current) = request.as_ref() else {
            return;
        };
        let result = self
            .request_query(
                "ms_teams_requests.native_stop",
                "UPDATE ms_teams_requests SET native_stop_available=$3 WHERE id=$1 AND run_id=$2 RETURNING *",
                vec![current.id.into(), current.run_id.into(), available.into()],
            )
            .await;
        apply_tracked(request, result);
    }

    pub async fn mark_request_stopping(&self, request: &mut Option<TeamsRequest>) {
        let Some(current) = request.as_ref() else {
            return;
        };
        let result = self
            .request_query(
                "ms_teams_requests.mark_stopping",
                "UPDATE ms_teams_requests SET state='stopping' WHERE id=$1 AND run_id=$2 RETURNING *",
                vec![current.id.into(), current.run_id.into()],
            )
            .await;
        apply_tracked(request, result);
    }

    /// A Stop for this run may have arrived from another activity or replica.
    pub async fn stop_was_requested(&self, request: Option<&TeamsRequest>) -> bool {
        let Some(request) = request else {
            return false;
        };
        match self.request_snapshot(request.id).await {
            Ok(current) => current.is_some_and(|current| {
                current.run_id == request.run_id && current.state == RequestState::Stopping
            }),
            Err(error) => {
                tracing::warn!(%error, "Could not check whether the Teams request was stopped");
                false
            }
        }
    }

    /// Does not overwrite a newer pending edit. A retry is offered only when
    /// the turn never attempted a tool and an assistant message was persisted.
    /// Returns `None` when a newer run took the request over.
    pub async fn finish_request(
        &self,
        request: &TeamsRequest,
        state: RequestState,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.finish",
            "UPDATE ms_teams_requests SET state=$2,
             action_token=CASE WHEN pending_edit IS NOT NULL THEN action_token
                 WHEN $2 IN ('stopped','failed') AND NOT tools_started AND assistant_message_id IS NOT NULL THEN $3 ELSE NULL END,
             action_kind=CASE WHEN pending_edit IS NOT NULL THEN action_kind
                 WHEN $2 IN ('stopped','failed') AND NOT tools_started AND assistant_message_id IS NOT NULL THEN 'retry' ELSE NULL END,
             action_expires_at=CASE WHEN pending_edit IS NOT NULL THEN action_expires_at ELSE now()+make_interval(hours => $5) END
             WHERE id=$1 AND run_id=$4 RETURNING *",
            vec![
                request.id.into(),
                state.into(),
                Uuid::new_v4().into(),
                request.run_id.into(),
                ACTION_TTL_HOURS.into(),
            ],
        )
        .await
    }

    /// Out-of-order edit callbacks and duplicate deliveries cannot revive an
    /// older revision or invalidate the newest card.
    pub async fn propose_edit(
        &self,
        request_id: Uuid,
        text: &str,
        edited_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.propose_edit",
            "UPDATE ms_teams_requests SET pending_edit=$2, last_edit_at=$3,
             action_token=$4, action_kind='edit', action_expires_at=now()+make_interval(hours => $5)
             WHERE id=$1 AND (last_edit_at IS NULL OR last_edit_at < $3) RETURNING *",
            vec![
                request_id.into(),
                text.into(),
                edited_at.into(),
                Uuid::new_v4().into(),
                ACTION_TTL_HOURS.into(),
            ],
        )
        .await
    }

    /// All callers first authenticate and bind the action to its conversation.
    /// This atomic claim makes double clicks and cross-replica retries harmless.
    /// The claimed token becomes the run ID, which fences out writes from any
    /// renderer of an earlier run.
    pub async fn claim_request_action(
        &self,
        request: &TeamsRequest,
        token: Uuid,
        kind: ActionKind,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.claim_action",
            "UPDATE ms_teams_requests SET action_token=NULL, claimed_action_token=$2, run_id=$2, state='preparing'
             WHERE id=$1 AND action_token=$2 AND action_kind=$3
             AND state IN ('stopped','failed','completed')
             AND action_expires_at > now() RETURNING *",
            vec![request.id.into(), token.into(), kind.into()],
        )
        .await
    }

    /// Undo a claim whose revision did not start, so the button works again.
    /// `previous` is the row before the claim. A newer edit may already have
    /// supplied a different token; preserve it.
    pub async fn restore_request_action(
        &self,
        claimed: &TeamsRequest,
        token: Uuid,
        previous: &TeamsRequest,
    ) -> Result<(), Report> {
        self.app_state
            .db
            .execute_raw(statement(
                "ms_teams_requests.restore_action",
                "UPDATE ms_teams_requests SET state=$3, run_id=$4, claimed_action_token=NULL,
                 action_token=CASE WHEN action_token IS NULL AND action_kind=$5 THEN $2 ELSE action_token END
                 WHERE id=$1 AND claimed_action_token=$2 AND run_id=$2",
                vec![
                    claimed.id.into(),
                    token.into(),
                    previous.state.into(),
                    previous.run_id.into(),
                    claimed.action_kind.into(),
                ],
            ))
            .await?;
        Ok(())
    }

    /// The revision was refused for good: drop the used action, and its edit
    /// text unless a newer edit replaced it. The earlier run keeps its ID.
    pub async fn reject_request_action(
        &self,
        claimed: &TeamsRequest,
        previous: &TeamsRequest,
    ) -> Result<(), Report> {
        self.app_state
            .db
            .execute_raw(statement(
                "ms_teams_requests.reject_action",
                "UPDATE ms_teams_requests SET state=$3, run_id=$4, claimed_action_token=NULL,
                 pending_edit=CASE WHEN action_token IS NULL THEN NULL ELSE pending_edit END,
                 action_kind=CASE WHEN action_token IS NULL THEN NULL ELSE action_kind END
                 WHERE id=$1 AND run_id=$2 AND claimed_action_token=$2",
                vec![
                    claimed.id.into(),
                    claimed.run_id.into(),
                    previous.state.into(),
                    previous.run_id.into(),
                ],
            ))
            .await?;
        Ok(())
    }

    /// The claimed revision started. Until it announces its own answer, a
    /// failure must not offer a Retry of the answer it replaces.
    pub async fn reset_request_action(
        &self,
        claimed: &TeamsRequest,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "ms_teams_requests.reset_action",
            "UPDATE ms_teams_requests SET state='preparing', tools_started=false, claimed_action_token=NULL, assistant_message_id=NULL,
             pending_edit=CASE WHEN action_token IS NULL THEN NULL ELSE pending_edit END,
             action_kind=CASE WHEN action_token IS NULL THEN NULL ELSE action_kind END
             WHERE id=$1 AND run_id=$2 AND claimed_action_token=$2 RETURNING *",
            vec![claimed.id.into(), claimed.run_id.into()],
        )
        .await
    }

    /// The active thread tip, when this request's question is still the latest
    /// one: the tip is the question, its recorded answer, or an answer to it
    /// that a revision of this request left behind. Old cards cannot branch
    /// away later replies or reach a different /new chat. Web authorization is
    /// rechecked again by the shared start method.
    pub async fn current_tip(
        &self,
        session: &Session,
        request: &TeamsRequest,
    ) -> Result<Option<Uuid>, Report> {
        if request.user_id != session.user_id
            || !self
                .usable_chat(session, request.chat_id, &self.app_state.db)
                .await?
        {
            return Ok(None);
        }
        let mapped = MsTeamsConversations::find()
            .filter(ms_teams_conversations::Column::ConversationId.eq(&request.conversation_id))
            .filter(ms_teams_conversations::Column::UserId.eq(session.user_id))
            .filter(ms_teams_conversations::Column::CurrentChatId.eq(request.chat_id))
            .one(&self.app_state.db)
            .await?
            .is_some();
        if !mapped {
            return Ok(None);
        }
        let tip =
            crate::models::message::get_active_thread_tip(&self.app_state.db, &request.chat_id)
                .await?;
        Ok(tip
            .filter(|tip| {
                Some(tip.id) == request.assistant_message_id
                    || request.user_message_id.is_some_and(|question| {
                        tip.id == question || tip.previous_message_id == Some(question)
                    })
            })
            .map(|tip| tip.id))
    }

    pub async fn request_is_current(
        &self,
        session: &Session,
        request: &TeamsRequest,
    ) -> Result<bool, Report> {
        Ok(self.current_tip(session, request).await?.is_some())
    }

    pub async fn stop_request(
        &self,
        session: &Session,
        request: &TeamsRequest,
        message_id: Uuid,
    ) -> Result<bool, Report> {
        if request.assistant_message_id != Some(message_id)
            || !self.request_is_current(session, request).await?
        {
            return Ok(false);
        }
        let active = self
            .app_state
            .background_tasks
            .active_generation(&request.chat_id)
            .await
            .is_some_and(|generation| generation.message_id() == Some(message_id));
        if !active {
            return Ok(false);
        }
        // Mark the request before aborting: its renderer, possibly on another
        // replica, reads this to settle as stopped rather than failed.
        let updated = self.app_state.db.execute_raw(statement(
            "ms_teams_requests.stop",
            "UPDATE ms_teams_requests SET state='stopping' WHERE id=$1 AND assistant_message_id=$2 AND run_id=$3 AND state IN ('running','stopping')",
            vec![request.id.into(), message_id.into(), request.run_id.into()],
        )).await?;
        if updated.rows_affected() == 0 {
            return Ok(false);
        }
        self.stop_generation(request.chat_id, message_id).await;
        Ok(true)
    }

    /// A dead renderer is not a safe source of Retry eligibility. Expire its
    /// controls without replaying a request or guessing whether tools ran.
    pub async fn expire_request_controls(&self, request: &TeamsRequest) -> Result<(), Report> {
        self.app_state.db.execute_raw(statement(
            "ms_teams_requests.expire_controls",
            "UPDATE ms_teams_requests SET state='failed', action_token=NULL, action_kind=NULL, pending_edit=NULL, claimed_action_token=NULL
             WHERE id=$1 AND run_id=$2 AND state IN ('preparing','running','stopping')",
            vec![request.id.into(), request.run_id.into()],
        )).await?;
        Ok(())
    }

    /// Ask for the controls to be rendered again, and take the delivery lease
    /// when nobody holds it. Only the new lease holder gets the row back; a
    /// current holder renders the bumped version after its own delivery.
    pub async fn claim_controls(
        &self,
        request_id: Uuid,
        owner: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        let row = self
            .request_query(
                "ms_teams_requests.claim_controls",
                "UPDATE ms_teams_requests SET controls_version=controls_version+1,
                 controls_lease_owner=CASE WHEN controls_lease_until IS NULL OR controls_lease_until < now()
                     THEN $2 ELSE controls_lease_owner END,
                 controls_lease_until=CASE WHEN controls_lease_until IS NULL OR controls_lease_until < now()
                     THEN now()+make_interval(secs => $3) ELSE controls_lease_until END
                 WHERE id=$1 RETURNING *",
                vec![request_id.into(), owner.into(), CONTROLS_LEASE_SECS.into()],
            )
            .await?;
        Ok(row.filter(|row| row.controls_lease_owner == Some(owner)))
    }

    /// Record the card that now shows `delivered`, and release the lease
    /// unless a newer version arrived meanwhile: then the returned row is
    /// rendered too. `give_up` releases regardless.
    pub async fn release_controls(
        &self,
        delivered: &TeamsRequest,
        owner: Uuid,
        card: Option<&str>,
        give_up: bool,
    ) -> Result<Option<TeamsRequest>, Report> {
        let row = self
            .request_query(
                "ms_teams_requests.release_controls",
                "UPDATE ms_teams_requests SET control_activity_id=$3,
                 controls_lease_owner=CASE WHEN $5 OR controls_version=$4 THEN NULL ELSE controls_lease_owner END,
                 controls_lease_until=CASE WHEN $5 OR controls_version=$4 THEN NULL
                     ELSE now()+make_interval(secs => $6) END
                 WHERE id=$1 AND controls_lease_owner=$2 RETURNING *",
                vec![
                    delivered.id.into(),
                    owner.into(),
                    card.map(str::to_string).into(),
                    delivered.controls_version.into(),
                    give_up.into(),
                    CONTROLS_LEASE_SECS.into(),
                ],
            )
            .await?;
        Ok(row.filter(|row| row.controls_lease_owner == Some(owner)))
    }

    pub async fn revise_request(
        &self,
        session: &Session,
        request: &TeamsRequest,
        kind: ActionKind,
    ) -> Result<mpsc::Receiver<GenerationUpdate>, StartError> {
        let tip = self
            .current_tip(session, request)
            .await
            .map_err(|error| StartError::internal("check the latest question", error))?
            .ok_or_else(|| StartError::Rejected(STALE_REVISION_MESSAGE.into()))?;
        // Do not inspect a partially persisted aborted turn and then race its
        // cleanup into a new lease: its final tool effects may still be saved.
        if self.generation_active(request.chat_id).await {
            return Err(StartError::Busy);
        }
        let started = match kind {
            ActionKind::Retry => {
                let message_id = request
                    .assistant_message_id
                    .filter(|message_id| *message_id == tip)
                    .ok_or_else(|| {
                        StartError::Rejected("There is no saved answer to retry.".into())
                    })?;
                let assistant = Messages::find_by_id(message_id)
                    .one(&self.app_state.db)
                    .await
                    .map_err(|error| StartError::internal("load the answer to retry", error))?
                    .filter(|message| message.chat_id == request.chat_id)
                    .ok_or_else(|| {
                        StartError::Rejected("This answer is no longer available.".into())
                    })?;
                let parsed = MessageSchema::validate(&assistant.raw_message).map_err(|error| {
                    tracing::warn!(%error, "Teams retry found an unreadable answer");
                    StartError::Rejected("This answer can no longer be retried.".into())
                })?;
                if request.tools_started
                    || parsed.content.iter().any(|part| {
                        !matches!(part, ContentPart::Text(_) | ContentPart::Reasoning(_))
                    })
                {
                    return Err(StartError::Rejected("Tools may already have run. Send a new instruction to continue without repeating their effects.".into()));
                }
                start_regeneration(
                    &self.app_state,
                    &session.policy,
                    &session.me,
                    teams_request_context(),
                    RegenerateMessageRequest::for_integration(message_id),
                    None,
                    Some(tip),
                )
                .await?
            }
            ActionKind::Edit => {
                let unavailable =
                    || StartError::Rejected("The original question is unavailable.".into());
                let user_message_id = request.user_message_id.ok_or_else(unavailable)?;
                let user_message = Messages::find_by_id(user_message_id)
                    .one(&self.app_state.db)
                    .await
                    .map_err(|error| StartError::internal("load the edited question", error))?
                    .filter(|message| message.chat_id == request.chat_id)
                    .ok_or_else(unavailable)?;
                let role = MessageSchema::validate(&user_message.raw_message)
                    .map_err(|error| {
                        tracing::warn!(%error, "Teams edit found an unreadable question");
                        unavailable()
                    })?
                    .role;
                if role != MessageRole::User {
                    return Err(StartError::Rejected(
                        "Only your question can be edited.".into(),
                    ));
                }
                let edited = request.pending_edit.clone().ok_or_else(|| {
                    StartError::Rejected("This edit is no longer available.".into())
                })?;
                start_edit(
                    &self.app_state,
                    &session.policy,
                    &session.me,
                    teams_request_context(),
                    EditMessageRequest::for_integration(
                        user_message_id,
                        edited,
                        user_message.input_file_uploads.unwrap_or_default(),
                    ),
                    None,
                    Some(tip),
                )
                .await?
            }
        };
        Ok(translate(
            started.chat_id,
            started.events,
            Some(started.client_stream_guard),
        ))
    }
}

fn apply_tracked(request: &mut Option<TeamsRequest>, result: Result<Option<TeamsRequest>, Report>) {
    match result {
        Ok(Some(updated)) => *request = Some(updated),
        Ok(None) => {
            tracing::debug!("A newer run took over the Teams request; no longer tracking it");
            *request = None;
        }
        Err(error) => {
            tracing::warn!(%error, "Teams request bookkeeping failed; delivery continues");
        }
    }
}
