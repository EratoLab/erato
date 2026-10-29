//! Executor streams (ERMAIN-1000): one stream per executor binding receives live
//! client tool calls from any of the account's chats, and nudges for new
//! durable operations of its binding. Presence and the pending-calls queue are
//! UNLOGGED rows, so any replica can hand a call to a stream held on another.
use super::{ExecutorBinding, OperationRequest};
use crate::query_metrics::named_statement_from_sql_and_values;
use chrono::{DateTime, Utc};
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;
use utoipa::ToSchema;

/// Presence heartbeat; the lease in SQL is 20 seconds, as for chat transports.
pub use super::transport::HEARTBEAT;
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const PRESENCE_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// A call that no stream could answer for this long settles as `context_unavailable`.
pub const PRESENCE_LOSS_GRACE: Duration = Duration::from_secs(15);

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        "client_operations.executor_stream",
        sql,
        values,
    )
}

/// A binding's live streams together: the stream of its newest pane, and the
/// tool names any of them advertised. A call goes to the newest pane that
/// serves its tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutorPresence {
    pub stream_id: Uuid,
    pub client_tools: Vec<String>,
    /// The tool names whose handlers accept grant calls on some stream.
    pub child_client_tools: Vec<String>,
}

impl ExecutorPresence {
    pub fn serves(&self, tool_name: &str) -> bool {
        self.client_tools.iter().any(|name| name == tool_name)
    }

    pub fn serves_grant_call(&self, tool_name: &str) -> bool {
        self.child_client_tools.iter().any(|name| name == tool_name)
    }
}

/// The chat and turn that own a call's client context, and the ones that made
/// the call. Only grant calls carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CallLineage {
    pub owner_chat_id: Uuid,
    pub owner_message_id: Uuid,
    pub requesting_chat_id: Uuid,
    pub requesting_message_id: Uuid,
    /// Opaque client context version, from the owner turn's action-facet arguments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub context_ref: Option<String>,
}

/// A live call handed to the stream that serves `binding`.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutorCall {
    pub account_id: Uuid,
    pub binding: ExecutorBinding,
    pub chat_id: Uuid,
    /// The run that made the call; the call is delivered only while it runs.
    pub generation_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: Value,
    pub lineage: Option<CallLineage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ExecutorStreamClientToolCall {
    pub chat_id: Uuid,
    pub message_id: Uuid,
    pub tool_call_id: String,
    pub tool_name: String,
    #[schema(value_type = super::OperationPayload)]
    pub input: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub lineage: Option<CallLineage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ExecutorStreamOperationAvailable {
    pub attempt_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "message_type")]
pub enum ExecutorStreamEvent {
    #[serde(rename = "client_tool_call")]
    /// Run the tool and POST the result to `clienttoolresult` with this
    /// stream's `X-Erato-Executor`.
    ClientToolCall(Box<ExecutorStreamClientToolCall>),
    #[serde(rename = "client_operation_available")]
    /// A durable operation for this binding can be claimed now.
    ClientOperationAvailable(ExecutorStreamOperationAvailable),
}

impl ExecutorStreamEvent {
    pub fn message_type(&self) -> &'static str {
        match self {
            Self::ClientToolCall(_) => "client_tool_call",
            Self::ClientOperationAvailable(_) => "client_operation_available",
        }
    }
}

impl From<&ExecutorCall> for ExecutorStreamEvent {
    fn from(call: &ExecutorCall) -> Self {
        Self::ClientToolCall(Box::new(ExecutorStreamClientToolCall {
            chat_id: call.chat_id,
            message_id: call.message_id,
            tool_call_id: call.tool_call_id.clone(),
            tool_name: call.tool_name.clone(),
            input: call.input.clone(),
            lineage: call.lineage.clone(),
        }))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum LiveCallRoute {
    /// The calling chat's own stream takes the call, as without executor streams.
    ChatStream,
    Executor(ExecutorPresence),
    /// No stream can take the call.
    Unavailable,
}

/// One stream of a pane for its binding.
#[derive(Debug, Clone)]
pub struct PresenceClaim {
    pub account_id: Uuid,
    pub binding: ExecutorBinding,
    /// `X-Erato-Executor-Instance`: the pane, the same for all its streams. A
    /// call is sent again only to a later stream of the pane it went to.
    pub instance_id: Option<Uuid>,
    pub connected_at: DateTime<Utc>,
    pub client_tools: Vec<String>,
    pub child_client_tools: Vec<String>,
}

impl PresenceClaim {
    /// When the pane opened: the time in its UUIDv7 instance id, else this
    /// stream's. The panes of a binding share a device, so their clocks agree.
    fn opened_at(&self) -> DateTime<Utc> {
        self.instance_id
            .and_then(uuid_v7_time)
            .unwrap_or(self.connected_at)
    }
}

fn uuid_v7_time(id: Uuid) -> Option<DateTime<Utc>> {
    if id.get_version_num() != 7 {
        return None;
    }
    let millis = id.as_bytes()[..6]
        .iter()
        .fold(0_i64, |millis, byte| millis << 8 | i64::from(*byte));
    DateTime::from_timestamp_millis(millis)
}

/// Writes or renews the stream's presence. Every stream of a binding has its
/// own row, so no stream waits for another.
pub async fn announce(
    db: &DatabaseConnection,
    claim: &PresenceClaim,
    stream_id: Uuid,
) -> Result<(), Report> {
    db.execute_raw(statement(
        r#"INSERT INTO client_executor_presence
             (stream_id, account_id, binding, instance_id, opened_at, connected_at, client_tools,
              child_client_tools, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '20 seconds')
           ON CONFLICT (stream_id) DO UPDATE SET expires_at = EXCLUDED.expires_at"#,
        vec![
            stream_id.into(),
            claim.account_id.into(),
            serde_json::to_value(&claim.binding)?.into(),
            claim.instance_id.into(),
            claim.opened_at().into(),
            claim.connected_at.into(),
            serde_json::to_value(&claim.client_tools)?.into(),
            serde_json::to_value(&claim.child_client_tools)?.into(),
        ],
    ))
    .await?;
    Ok(())
}

pub async fn release(db: &DatabaseConnection, stream_id: Uuid) -> Result<(), Report> {
    db.execute_raw(statement(
        "DELETE FROM client_executor_presence WHERE stream_id = $1",
        vec![stream_id.into()],
    ))
    .await?;
    Ok(())
}

pub async fn present(
    db: &DatabaseConnection,
    account_id: Uuid,
    binding: &ExecutorBinding,
) -> Result<Option<ExecutorPresence>, Report> {
    let rows = db
        .query_all_raw(statement(
            r#"SELECT stream_id, client_tools, child_client_tools FROM client_executor_presence
             WHERE account_id = $1 AND binding = $2 AND expires_at > now()
             ORDER BY opened_at DESC, connected_at DESC"#,
            vec![account_id.into(), serde_json::to_value(binding)?.into()],
        ))
        .await?;
    let mut presence: Option<ExecutorPresence> = None;
    for row in rows {
        let client_tools: Vec<String> = serde_json::from_value(row.try_get("", "client_tools")?)?;
        let child_client_tools: Vec<String> =
            serde_json::from_value(row.try_get("", "child_client_tools")?)?;
        let Some(presence) = presence.as_mut() else {
            presence = Some(ExecutorPresence {
                stream_id: row.try_get("", "stream_id")?,
                client_tools,
                child_client_tools,
            });
            continue;
        };
        for (names, more) in [
            (&mut presence.client_tools, client_tools),
            (&mut presence.child_client_tools, child_client_tools),
        ] {
            for name in more {
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
    }
    Ok(presence)
}

/// Precedence: a grant call always needs a stream that accepts grant calls for
/// the tool. Any other call stays on the calling chat's attached stream, else
/// goes to the binding's stream when it serves the tool.
pub async fn route_live_call(
    db: &DatabaseConnection,
    account_id: Uuid,
    binding: &ExecutorBinding,
    tool_name: &str,
    chat_stream_attached: bool,
    grant_call: bool,
) -> Result<LiveCallRoute, Report> {
    if grant_call {
        return Ok(match present(db, account_id, binding).await? {
            Some(presence) if presence.serves_grant_call(tool_name) => {
                LiveCallRoute::Executor(presence)
            }
            _ => LiveCallRoute::Unavailable,
        });
    }
    if chat_stream_attached {
        return Ok(LiveCallRoute::ChatStream);
    }
    Ok(match present(db, account_id, binding).await? {
        Some(presence) if presence.serves(tool_name) => LiveCallRoute::Executor(presence),
        _ => LiveCallRoute::Unavailable,
    })
}

/// Queue a live call for whichever stream serves its binding, on any replica.
pub async fn hand_over(db: &DatabaseConnection, call: &ExecutorCall) -> Result<(), Report> {
    db.execute_raw(statement(
        r#"INSERT INTO client_executor_calls
             (account_id, binding, chat_id, message_id, tool_call_id, generation_id, tool_name,
              grant_call, event)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (message_id, tool_call_id) WHERE attempt_id IS NULL
           DO UPDATE SET account_id = EXCLUDED.account_id, binding = EXCLUDED.binding,
             chat_id = EXCLUDED.chat_id, generation_id = EXCLUDED.generation_id,
             tool_name = EXCLUDED.tool_name, grant_call = EXCLUDED.grant_call,
             event = EXCLUDED.event, created_at = now(), delivered_at = NULL, delivered_to = NULL,
             delivered_instance = NULL"#,
        vec![
            call.account_id.into(),
            serde_json::to_value(&call.binding)?.into(),
            call.chat_id.into(),
            call.message_id.into(),
            call.tool_call_id.clone().into(),
            call.generation_id.into(),
            call.tool_name.clone().into(),
            call.lineage.is_some().into(),
            serde_json::to_value(ExecutorStreamEvent::from(call))?.into(),
        ],
    ))
    .await?;
    Ok(())
}

/// Announce a parked durable operation to its binding's stream. Released only
/// once the attempt can be claimed; the inbox poll stays the fallback.
pub async fn nudge(db: &DatabaseConnection, request: &OperationRequest) -> Result<(), Report> {
    let event = ExecutorStreamEvent::ClientOperationAvailable(ExecutorStreamOperationAvailable {
        attempt_id: request.attempt_id,
    });
    db.execute_raw(statement(
        r#"INSERT INTO client_executor_calls
             (account_id, binding, chat_id, message_id, tool_call_id, attempt_id, event)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        vec![
            request.account_id.into(),
            serde_json::to_value(&request.binding)?.into(),
            request.chat_id.into(),
            request.message_id.into(),
            request.tool_call_id.clone().into(),
            request.attempt_id.into(),
            serde_json::to_value(event)?.into(),
        ],
    ))
    .await?;
    Ok(())
}

/// The binding a handed-over call was addressed to, for results that reach
/// another replica than the run.
pub async fn call_binding(
    db: &DatabaseConnection,
    account_id: Uuid,
    chat_id: Uuid,
    message_id: Uuid,
    tool_call_id: &str,
) -> Result<Option<ExecutorBinding>, Report> {
    db.query_one_raw(statement(
        r#"SELECT binding FROM client_executor_calls
           WHERE account_id = $1 AND chat_id = $2 AND message_id = $3 AND tool_call_id = $4
             AND attempt_id IS NULL"#,
        vec![
            account_id.into(),
            chat_id.into(),
            message_id.into(),
            tool_call_id.into(),
        ],
    ))
    .await?
    .map(|row| -> Result<ExecutorBinding, Report> {
        Ok(serde_json::from_value(row.try_get("", "binding")?)?)
    })
    .transpose()
}

pub async fn settle(
    db: &DatabaseConnection,
    message_id: Uuid,
    tool_call_id: &str,
) -> Result<(), Report> {
    db.execute_raw(statement(
        r#"DELETE FROM client_executor_calls
           WHERE message_id = $1 AND tool_call_id = $2 AND attempt_id IS NULL"#,
        vec![message_id.into(), tool_call_id.into()],
    ))
    .await?;
    Ok(())
}

/// Rows a crashed run, an expired presence or a settled operation left behind.
pub async fn cleanup(db: &DatabaseConnection) -> Result<(), Report> {
    db.execute_raw(statement(
        "DELETE FROM client_executor_presence WHERE expires_at < now() - interval '1 minute'",
        Vec::new(),
    ))
    .await?;
    db.execute_raw(statement(
        r#"DELETE FROM client_executor_calls q
           WHERE q.created_at < now() - interval '1 day'
              OR (q.attempt_id IS NULL AND NOT EXISTS (
                    SELECT 1 FROM chats c WHERE c.id = q.chat_id
                    AND c.active_generation_id = q.generation_id AND c.generation_state = 'running'))
              OR (q.attempt_id IS NOT NULL AND (q.delivered_at IS NOT NULL OR NOT EXISTS (
                    SELECT 1 FROM client_operation_attempts a
                    WHERE a.attempt_id = q.attempt_id AND a.state = 'pending')))"#,
        Vec::new(),
    ))
    .await?;
    Ok(())
}

/// The streams `p` that may answer call `q`, the newest pane first: a nudge any
/// stream of its binding; a delivered call only a stream of the pane it went
/// to, so it never runs twice or in a pane the user left open elsewhere; any
/// other call a stream that serves its tool.
const ANSWERING_STREAMS: &str = r#"p.account_id = q.account_id AND p.binding = q.binding
      AND p.expires_at > now()
      AND CASE WHEN q.attempt_id IS NOT NULL THEN true
            WHEN q.delivered_instance IS NOT NULL THEN p.instance_id = q.delivered_instance
            WHEN q.delivered_to IS NOT NULL THEN p.stream_id = q.delivered_to
            WHEN q.grant_call THEN p.child_client_tools @> jsonb_build_array(q.tool_name)
            ELSE p.client_tools @> jsonb_build_array(q.tool_name) END"#;

async fn answerable(db: &DatabaseConnection, call: &ExecutorCall) -> Result<bool, Report> {
    let row = db
        .query_one_raw(statement(
            &format!(
                r#"SELECT EXISTS (
                     SELECT 1 FROM client_executor_calls q
                     JOIN client_executor_presence p ON {ANSWERING_STREAMS}
                     WHERE q.message_id = $1 AND q.tool_call_id = $2 AND q.attempt_id IS NULL
                   ) AS answerable"#
            ),
            vec![call.message_id.into(), call.tool_call_id.clone().into()],
        ))
        .await?
        .ok_or_else(|| eyre::eyre!("EXISTS returned no row"))?;
    Ok(row.try_get("", "answerable")?)
}

/// Returns once no stream could answer the call for [`PRESENCE_LOSS_GRACE`],
/// from the hand-over on: none serves its tool, or none of the pane it went to
/// is left. A stream that appears resets the grace, so a pane that reconnects
/// in time still gets the call; a failed lookup counts as answerable.
pub async fn wait_for_presence_loss(db: &DatabaseConnection, call: &ExecutorCall) {
    let mut absent_since = None;
    loop {
        match answerable(db, call).await {
            Ok(true) => absent_since = None,
            Ok(false) => {
                if absent_since
                    .get_or_insert_with(tokio::time::Instant::now)
                    .elapsed()
                    >= PRESENCE_LOSS_GRACE
                {
                    return;
                }
            }
            Err(error) => {
                tracing::warn!(%error, "Cannot determine executor stream presence");
                absent_since = None;
            }
        }
        tokio::time::sleep(PRESENCE_POLL_INTERVAL).await;
    }
}

type StreamSender = UnboundedSender<ExecutorStreamEvent>;

/// The streams this replica holds presence for, and one poll loop for all of
/// them. Pane streams stay open for hours, so a query per stream would not do.
#[derive(Clone, Default)]
pub struct ExecutorStreamHub(Arc<HubInner>);

#[derive(Default)]
struct HubInner {
    streams: Mutex<HashMap<Uuid, StreamSender>>,
    polling: AtomicBool,
}

impl ExecutorStreamHub {
    fn register(&self, db: &DatabaseConnection, stream_id: Uuid, sender: StreamSender) {
        self.0
            .streams
            .lock()
            .expect("executor streams lock poisoned")
            .insert(stream_id, sender);
        if !self.0.polling.swap(true, Ordering::AcqRel) {
            tokio::spawn(poll(db.clone(), Arc::downgrade(&self.0)));
        }
    }

    fn unregister(&self, stream_id: Uuid) {
        self.0
            .streams
            .lock()
            .expect("executor streams lock poisoned")
            .remove(&stream_id);
    }
}

async fn poll(db: DatabaseConnection, hub: Weak<HubInner>) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let Some(hub) = hub.upgrade() else {
            return;
        };
        let streams: Vec<Uuid> = hub
            .streams
            .lock()
            .expect("executor streams lock poisoned")
            .keys()
            .copied()
            .collect();
        if streams.is_empty() {
            continue;
        }
        let mut deliveries = match claim(&db, &streams).await {
            Ok(deliveries) => deliveries,
            Err(error) => {
                tracing::warn!(%error, "Failed to poll executor stream calls");
                continue;
            }
        };
        deliveries.sort_by_key(|(call_id, _, _)| *call_id);
        let mut undelivered = Vec::new();
        {
            let senders = hub.streams.lock().expect("executor streams lock poisoned");
            for (call_id, stream_id, event) in deliveries {
                let sent = senders
                    .get(&stream_id)
                    .is_some_and(|sender| sender.send(event).is_ok());
                if !sent {
                    undelivered.push(call_id);
                }
            }
        }
        if !undelivered.is_empty()
            && let Err(error) = db
                .execute_raw(statement(
                    r#"UPDATE client_executor_calls
                       SET delivered_at = NULL, delivered_to = NULL, delivered_instance = NULL
                       WHERE call_id = ANY($1::bigint[])"#,
                    vec![undelivered.into()],
                ))
                .await
        {
            tracing::warn!(%error, "Failed to requeue executor stream calls");
        }
    }
}

/// Marks every due row whose answering stream is held here as delivered to it.
/// A live call is due while its run is running, until the newest stream of its
/// pane has had it: a pane that reconnects gets it again, since the event may
/// have died with the old stream. A nudge is due once, when its attempt is
/// claimable: pending, its chat not running.
async fn claim(
    db: &DatabaseConnection,
    streams: &[Uuid],
) -> Result<Vec<(i64, Uuid, ExecutorStreamEvent)>, Report> {
    db.query_all_raw(statement(
        &format!(
            r#"WITH due AS (
                 SELECT q.call_id, t.stream_id, t.instance_id FROM client_executor_calls q
                 CROSS JOIN LATERAL (
                   SELECT p.stream_id, p.instance_id FROM client_executor_presence p
                   WHERE {ANSWERING_STREAMS}
                   ORDER BY p.opened_at DESC, p.connected_at DESC LIMIT 1
                 ) t
                 WHERE t.stream_id = ANY($1::uuid[])
                   AND CASE WHEN q.attempt_id IS NULL THEN q.delivered_to IS DISTINCT FROM t.stream_id
                         AND EXISTS (
                           SELECT 1 FROM chats c
                           WHERE c.id = q.chat_id AND c.active_generation_id = q.generation_id
                             AND c.generation_state = 'running')
                       ELSE q.delivered_at IS NULL AND EXISTS (
                         SELECT 1 FROM client_operation_attempts a JOIN chats c ON c.id = a.chat_id
                         WHERE a.attempt_id = q.attempt_id AND a.state = 'pending'
                           AND a.expires_at > now() AND c.archived_at IS NULL
                           AND c.generation_state IS DISTINCT FROM 'running')
                       END
                 FOR UPDATE OF q SKIP LOCKED
               )
               UPDATE client_executor_calls q SET delivered_at = now(), delivered_to = due.stream_id,
                 delivered_instance = due.instance_id
               FROM due WHERE q.call_id = due.call_id
               RETURNING q.call_id, due.stream_id, q.event"#
        ),
        vec![streams.to_vec().into()],
    ))
    .await?
    .into_iter()
    .map(|row| -> Result<_, Report> {
        Ok((
            row.try_get("", "call_id")?,
            row.try_get("", "stream_id")?,
            serde_json::from_value(row.try_get("", "event")?)?,
        ))
    })
    .collect()
}

/// A stream's presence for its binding, from connect until the guard drops.
/// It renews every heartbeat and receives the calls routed to it.
pub struct PresenceGuard {
    db: DatabaseConnection,
    hub: ExecutorStreamHub,
    stream_id: Uuid,
    heartbeat: JoinHandle<()>,
}

impl PresenceGuard {
    pub async fn start(
        db: DatabaseConnection,
        hub: ExecutorStreamHub,
        claim: PresenceClaim,
        sender: StreamSender,
    ) -> Self {
        let stream_id = Uuid::new_v4();
        if let Err(error) = announce(&db, &claim, stream_id).await {
            tracing::warn!(%error, "Executor stream presence failed; the heartbeat retries");
        }
        hub.register(&db, stream_id, sender);
        let heartbeat = tokio::spawn({
            let db = db.clone();
            async move {
                loop {
                    tokio::time::sleep(HEARTBEAT).await;
                    if let Err(error) = announce(&db, &claim, stream_id).await {
                        tracing::warn!(%error, "Executor stream heartbeat failed");
                    }
                }
            }
        });
        Self {
            db,
            hub,
            stream_id,
            heartbeat,
        }
    }

    pub fn stream_id(&self) -> Uuid {
        self.stream_id
    }
}

impl Drop for PresenceGuard {
    fn drop(&mut self) {
        self.heartbeat.abort();
        self.hub.unregister(self.stream_id);
        let db = self.db.clone();
        let stream_id = self.stream_id;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Err(error) = release(&db, stream_id).await {
                    tracing::warn!(%error, "Executor stream release failed");
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_carry_their_message_type() {
        let call = ExecutorCall {
            account_id: Uuid::nil(),
            binding: ExecutorBinding {
                device_id: "device".into(),
                realm: super::super::ExecutionRealm::OfficeAddin,
                host_context: None,
            },
            chat_id: Uuid::nil(),
            generation_id: Uuid::nil(),
            message_id: Uuid::nil(),
            tool_call_id: "call".into(),
            tool_name: "read".into(),
            input: serde_json::json!({"a": 1}),
            lineage: None,
        };
        let event = ExecutorStreamEvent::from(&call);
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["message_type"], event.message_type());
        assert_eq!(value["tool_name"], "read");
        assert!(value.get("lineage").is_none());
        assert_eq!(
            serde_json::from_value::<ExecutorStreamEvent>(value).unwrap(),
            event
        );
    }

    #[test]
    fn a_pane_opened_when_its_v7_instance_was_made() {
        let connected_at = Utc::now();
        let claim = |instance_id| PresenceClaim {
            account_id: Uuid::nil(),
            binding: ExecutorBinding {
                device_id: "device".into(),
                realm: super::super::ExecutionRealm::OfficeAddin,
                host_context: None,
            },
            instance_id,
            connected_at,
            client_tools: Vec::new(),
            child_client_tools: Vec::new(),
        };
        let v7 = Uuid::parse_str("019a2b3c-4d5e-7f00-8000-000000000000").unwrap();
        assert_eq!(
            claim(Some(v7)).opened_at().timestamp_millis(),
            0x019a_2b3c_4d5e
        );
        assert_eq!(claim(Some(Uuid::new_v4())).opened_at(), connected_at);
        assert_eq!(claim(None).opened_at(), connected_at);
    }
}
