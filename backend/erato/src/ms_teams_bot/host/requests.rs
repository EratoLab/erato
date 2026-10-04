//! Durable request routing and one-use controls. Card payloads never supply
//! chat/message IDs or edited text; those are resolved from this store.

use super::*;
use crate::models::message::MessageRole;
use crate::server::api::v1beta::message_streaming::{
    EditMessageRequest, RegenerateMessageRequest, start_edit, start_regeneration,
};
use sea_orm::{DbBackend, FromQueryResult, Statement};

#[derive(Debug, Clone, FromQueryResult)]
pub struct TeamsRequest {
    pub id: Uuid,
    pub conversation_id: String,
    pub source_activity_id: String,
    pub user_id: Uuid,
    pub chat_id: Uuid,
    pub user_message_id: Option<Uuid>,
    pub assistant_message_id: Option<Uuid>,
    pub control_activity_id: Option<String>,
    pub state: String,
    pub tools_started: bool,
    pub native_stop_available: bool,
    pub pending_edit: Option<String>,
    pub action_token: Option<Uuid>,
    pub action_kind: Option<String>,
    pub run_id: Uuid,
    pub claimed_action_token: Option<Uuid>,
}

impl TeamsRequest {
    pub fn running(&self) -> bool {
        matches!(self.state.as_str(), "preparing" | "running" | "stopping")
    }
}

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Postgres, sql, values)
}

impl Host {
    /// Serialize Connector card mutations across replicas, independently of
    /// generation state. Re-read the row after taking this lock.
    pub async fn lock_request_controls(
        &self,
        request_id: Uuid,
    ) -> Result<sea_orm::DatabaseTransaction, Report> {
        let transaction = self.app_state.db.begin().await?;
        transaction
            .execute_raw(statement(
                "SELECT pg_advisory_xact_lock(hashtextextended('teams-controls:' || $1::text, 0))",
                vec![request_id.to_string().into()],
            ))
            .await?;
        Ok(transaction)
    }

    async fn request_query(
        &self,
        sql: &str,
        values: Vec<sea_orm::Value>,
    ) -> Result<Option<TeamsRequest>, Report> {
        Ok(TeamsRequest::find_by_statement(statement(sql, values))
            .one(&self.app_state.db)
            .await?)
    }

    /// Duplicate delivery of the same Teams activity must not generate again.
    pub async fn remember_request(
        &self,
        session: &Session,
        conversation: &str,
        activity_id: &str,
        chat_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
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
            "SELECT * FROM ms_teams_requests WHERE user_id=$1 AND conversation_id=$2 AND source_activity_id=$3",
            vec![session.user_id.into(), conversation.into(), activity_id.into()],
        ).await
    }

    pub async fn request_for_assistant(
        &self,
        message_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "SELECT * FROM ms_teams_requests WHERE assistant_message_id=$1",
            vec![message_id.into()],
        )
        .await
    }

    pub async fn latest_request(
        &self,
        session: &Session,
        conversation: &str,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query("SELECT * FROM ms_teams_requests WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 1",
            vec![session.user_id.into(), conversation.into()]).await
    }

    pub async fn request_snapshot(&self, request_id: Uuid) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "SELECT * FROM ms_teams_requests WHERE id=$1",
            vec![request_id.into()],
        )
        .await
    }

    pub async fn record_user_message(
        &self,
        request: &TeamsRequest,
        message_id: Uuid,
    ) -> Result<(), Report> {
        self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET user_message_id=$2, updated_at=now() WHERE id=$1 AND run_id=$3",
            vec![request.id.into(), message_id.into(), request.run_id.into()],
        )).await?;
        Ok(())
    }

    pub async fn locked_request_snapshot(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        request_id: Uuid,
    ) -> Result<Option<TeamsRequest>, Report> {
        Ok(TeamsRequest::find_by_statement(statement(
            "SELECT * FROM ms_teams_requests WHERE id=$1",
            vec![request_id.into()],
        ))
        .one(transaction)
        .await?)
    }

    pub async fn record_generation(
        &self,
        request: &TeamsRequest,
        message_id: Uuid,
    ) -> Result<TeamsRequest, Report> {
        self.request_query(
            "UPDATE ms_teams_requests SET assistant_message_id=$2, state='running', updated_at=now() WHERE id=$1 AND run_id=$3 RETURNING *",
            vec![request.id.into(), message_id.into(), request.run_id.into()],
        ).await?.ok_or_else(|| eyre!("Teams request disappeared"))
    }

    /// Persist the delivery mode so edit callbacks on any replica can avoid
    /// adding a second Stop button beside Teams' native one.
    pub async fn record_native_stop(
        &self,
        request: &TeamsRequest,
        available: bool,
    ) -> Result<TeamsRequest, Report> {
        self.request_query(
            "UPDATE ms_teams_requests SET native_stop_available=$3 WHERE id=$1 AND run_id=$2 RETURNING *",
            vec![request.id.into(), request.run_id.into(), available.into()],
        ).await?.ok_or_else(|| eyre!("Teams request disappeared or was replaced"))
    }

    pub async fn record_control_card(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        request_id: Uuid,
        activity_id: &str,
    ) -> Result<(), Report> {
        transaction
            .execute_raw(statement(
                "UPDATE ms_teams_requests SET control_activity_id=$2 WHERE id=$1",
                vec![request_id.into(), activity_id.into()],
            ))
            .await?;
        Ok(())
    }

    pub async fn clear_control_card(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        request_id: Uuid,
        activity_id: &str,
    ) -> Result<(), Report> {
        transaction.execute_raw(statement(
            "UPDATE ms_teams_requests SET control_activity_id=NULL WHERE id=$1 AND control_activity_id=$2",
            vec![request_id.into(), activity_id.into()],
        )).await?;
        Ok(())
    }

    pub async fn record_tool_started(&self, request: &TeamsRequest) -> Result<(), Report> {
        self.app_state
            .db
            .execute_raw(statement(
                "UPDATE ms_teams_requests SET tools_started=true WHERE id=$1 AND run_id=$2",
                vec![request.id.into(), request.run_id.into()],
            ))
            .await?;
        Ok(())
    }

    /// Does not overwrite a newer pending edit. A retry is offered only when
    /// the turn never attempted a tool and an assistant message was persisted.
    pub async fn finish_request(
        &self,
        request: &TeamsRequest,
        state: &str,
    ) -> Result<TeamsRequest, Report> {
        self.request_query(
            "UPDATE ms_teams_requests SET state=$2, updated_at=now(),
             action_token=CASE WHEN pending_edit IS NOT NULL THEN action_token
                 WHEN $2 IN ('stopped','failed') AND NOT tools_started AND assistant_message_id IS NOT NULL THEN $3 ELSE NULL END,
             action_kind=CASE WHEN pending_edit IS NOT NULL THEN action_kind
                 WHEN $2 IN ('stopped','failed') AND NOT tools_started AND assistant_message_id IS NOT NULL THEN 'retry' ELSE NULL END,
             action_expires_at=CASE WHEN pending_edit IS NOT NULL THEN action_expires_at ELSE now()+interval '1 day' END
             WHERE id=$1 AND run_id=$4 RETURNING *",
            vec![request.id.into(), state.into(), Uuid::new_v4().into(), request.run_id.into()],
        ).await?.ok_or_else(|| eyre!("Teams request disappeared"))
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
            "UPDATE ms_teams_requests SET pending_edit=$2, last_edit_at=$3,
             action_token=$4, action_kind='edit', action_expires_at=now()+interval '1 day', updated_at=now()
             WHERE id=$1 AND (last_edit_at IS NULL OR last_edit_at < $3) RETURNING *",
            vec![request_id.into(), text.into(), edited_at.into(), Uuid::new_v4().into()],
        ).await
    }

    /// All callers first authenticate and bind the action to its conversation.
    /// This atomic claim makes double clicks and cross-replica retries harmless.
    pub async fn claim_request_action(
        &self,
        request: &TeamsRequest,
        token: Uuid,
        kind: &str,
    ) -> Result<Option<TeamsRequest>, Report> {
        self.request_query(
            "UPDATE ms_teams_requests SET action_token=NULL, claimed_action_token=$2, run_id=$2, state='preparing', updated_at=now()
             WHERE id=$1 AND action_token=$2 AND action_kind=$3
             AND state IN ('stopped','failed','completed')
             AND action_expires_at > now() RETURNING *",
            vec![request.id.into(), token.into(), kind.into()],
        ).await
    }

    pub async fn restore_request_action(
        &self,
        request: &TeamsRequest,
        token: Uuid,
        previous_state: &str,
    ) -> Result<(), Report> {
        // A new edit may already have supplied a different token; preserve it.
        self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET state=$4, claimed_action_token=NULL,
             action_token=CASE WHEN action_token IS NULL AND action_kind=$3 THEN $2 ELSE action_token END
             WHERE id=$1 AND claimed_action_token=$2 AND run_id=$2",
            vec![request.id.into(), token.into(), request.action_kind.clone().into(), previous_state.into()],
        )).await?;
        Ok(())
    }

    pub async fn reset_request_action(&self, request: &TeamsRequest) -> Result<(), Report> {
        self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET state='preparing', tools_started=false, claimed_action_token=NULL, assistant_message_id=NULL,
             pending_edit=CASE WHEN action_token IS NULL THEN NULL ELSE pending_edit END,
             action_kind=CASE WHEN action_token IS NULL THEN NULL ELSE action_kind END,
             updated_at=now() WHERE id=$1 AND run_id=$2 AND claimed_action_token=$2",
            vec![request.id.into(), request.run_id.into()],
        )).await?;
        Ok(())
    }

    pub async fn reject_request_action(
        &self,
        request: &TeamsRequest,
        previous_state: &str,
    ) -> Result<(), Report> {
        self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET state=$3, claimed_action_token=NULL WHERE id=$1 AND run_id=$2 AND claimed_action_token=$2",
            vec![request.id.into(), request.run_id.into(), previous_state.into()],
        )).await?;
        Ok(())
    }

    /// Old cards cannot branch away later replies or reach a different /new
    /// chat. Web authorization is rechecked again by the shared start method.
    pub async fn request_is_current(
        &self,
        session: &Session,
        request: &TeamsRequest,
    ) -> Result<bool, Report> {
        if request.user_id != session.user_id
            || !self
                .usable_chat(session, request.chat_id, &self.app_state.db)
                .await?
        {
            return Ok(false);
        }
        let mapped = MsTeamsConversations::find()
            .filter(ms_teams_conversations::Column::ConversationId.eq(&request.conversation_id))
            .filter(ms_teams_conversations::Column::UserId.eq(session.user_id))
            .filter(ms_teams_conversations::Column::CurrentChatId.eq(request.chat_id))
            .one(&self.app_state.db)
            .await?
            .is_some();
        let tip =
            crate::models::message::get_active_thread_tip(&self.app_state.db, &request.chat_id)
                .await?;
        Ok(mapped
            && tip.is_some_and(|tip| {
                Some(tip.id) == request.assistant_message_id
                    || Some(tip.id) == request.user_message_id
            }))
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
        let active = if let Some(task) = self
            .app_state
            .background_tasks
            .get_task(&request.chat_id)
            .await
        {
            task.message_id() == message_id
        } else {
            self.app_state
                .background_tasks
                .get_shared_generation(&request.chat_id)
                .await
                .is_some_and(|(_, active)| active == Some(message_id))
        };
        if !active {
            return Ok(false);
        }
        let updated = self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET state='stopping' WHERE id=$1 AND assistant_message_id=$2 AND run_id=$3 AND state IN ('running','stopping')",
            vec![request.id.into(), message_id.into(), request.run_id.into()],
        )).await?;
        if updated.rows_affected() == 0 {
            return Ok(false);
        }
        self.stop_generation(request.chat_id, message_id).await;
        Ok(true)
    }

    pub async fn request_was_stopped(&self, request_id: Uuid) -> Result<bool, Report> {
        Ok(self
            .request_query(
                "SELECT * FROM ms_teams_requests WHERE id=$1",
                vec![request_id.into()],
            )
            .await?
            .is_some_and(|request| request.state == "stopping"))
    }

    /// A dead renderer is not a safe source of Retry eligibility. Expire its
    /// controls without replaying a request or guessing whether tools ran.
    pub async fn expire_request_controls(&self, request: &TeamsRequest) -> Result<(), Report> {
        self.app_state.db.execute_raw(statement(
            "UPDATE ms_teams_requests SET state='failed', action_token=NULL, action_kind=NULL, pending_edit=NULL, claimed_action_token=NULL
             WHERE id=$1 AND run_id=$2 AND state IN ('preparing','running','stopping')",
            vec![request.id.into(), request.run_id.into()],
        )).await?;
        Ok(())
    }

    pub async fn mark_request_stopping(&self, request: &TeamsRequest) -> Result<(), Report> {
        self.app_state
            .db
            .execute_raw(statement(
                "UPDATE ms_teams_requests SET state='stopping' WHERE id=$1 AND run_id=$2",
                vec![request.id.into(), request.run_id.into()],
            ))
            .await?;
        Ok(())
    }

    pub async fn revise_request(
        &self,
        session: &Session,
        request: &TeamsRequest,
        kind: &str,
    ) -> Result<mpsc::Receiver<GenerationUpdate>, StartError> {
        if !self
            .request_is_current(session, request)
            .await
            .map_err(|e| StartError::Rejected(e.to_string()))?
        {
            return Err(StartError::Rejected(
                "This question is no longer the latest question in this chat.".into(),
            ));
        }
        let message_id = request
            .assistant_message_id
            .ok_or_else(|| StartError::Rejected("There is no saved answer to retry yet.".into()))?;
        // Do not inspect a partially persisted aborted turn and then race its
        // cleanup into a new lease: its final tool effects may still be saved.
        if self
            .app_state
            .background_tasks
            .get_task(&request.chat_id)
            .await
            .is_some()
            || self
                .app_state
                .background_tasks
                .get_shared_generation(&request.chat_id)
                .await
                .is_some()
        {
            return Err(StartError::Busy);
        }
        let assistant = Messages::find_by_id(message_id)
            .one(&self.app_state.db)
            .await
            .map_err(|e| StartError::Rejected(e.to_string()))?
            .ok_or_else(|| StartError::Rejected("This answer is no longer available.".into()))?;
        let parsed = MessageSchema::validate(&assistant.raw_message)
            .map_err(|e| StartError::Rejected(e.to_string()))?;
        if kind == "retry"
            && (request.tools_started
                || parsed
                    .content
                    .iter()
                    .any(|part| !matches!(part, ContentPart::Text(_) | ContentPart::Reasoning(_))))
        {
            return Err(StartError::Rejected("Tools may already have run. Send a new instruction to continue without repeating their effects.".into()));
        }
        let started = if kind == "edit" {
            let user_message_id = request.user_message_id.ok_or_else(|| {
                StartError::Rejected("The original question is unavailable.".into())
            })?;
            let user_message = Messages::find_by_id(user_message_id)
                .one(&self.app_state.db)
                .await
                .map_err(|e| StartError::Rejected(e.to_string()))?
                .filter(|message| message.chat_id == request.chat_id)
                .ok_or_else(|| {
                    StartError::Rejected("The original question is unavailable.".into())
                })?;
            if MessageSchema::validate(&user_message.raw_message)
                .map_err(|e| StartError::Rejected(e.to_string()))?
                .role
                != MessageRole::User
            {
                return Err(StartError::Rejected(
                    "Only your question can be edited.".into(),
                ));
            }
            start_edit(
                &self.app_state,
                &session.policy,
                &session.me,
                teams_request_context(),
                EditMessageRequest::for_integration(
                    user_message_id,
                    request.pending_edit.clone().ok_or_else(|| {
                        StartError::Rejected("This edit is no longer available.".into())
                    })?,
                    user_message.input_file_uploads.unwrap_or_default(),
                ),
                None,
                request.assistant_message_id,
            )
            .await?
        } else {
            start_regeneration(
                &self.app_state,
                &session.policy,
                &session.me,
                teams_request_context(),
                RegenerateMessageRequest::for_integration(message_id),
                None,
                request.assistant_message_id,
            )
            .await?
        };
        Ok(translate(
            started.chat_id,
            started.events,
            Some(started.client_stream_guard),
        ))
    }
}
