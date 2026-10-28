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
/// A call whose binding has no stream for this long settles as `context_unavailable`.
pub const PRESENCE_LOSS_GRACE: Duration = Duration::from_secs(15);

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        "client_operations.executor_stream",
        sql,
        values,
    )
}

/// The stream currently serving a binding, with the tool names it advertised.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutorPresence {
    pub stream_id: Uuid,
    pub client_tools: Vec<String>,
    /// The subset of `client_tools` whose handlers accept grant calls.
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

/// What a stream claims its binding with.
#[derive(Debug, Clone)]
pub struct PresenceClaim {
    pub account_id: Uuid,
    pub binding: ExecutorBinding,
    /// `X-Erato-Executor-Instance`: the same for every reconnect of one pane's
    /// stream, so the latest of them can take the binding over at once.
    pub instance_id: Option<Uuid>,
    /// Orders the streams of one instance. Reconnects are at least a second
    /// apart, far more than the clock skew between replicas.
    pub connected_at: DateTime<Utc>,
    pub client_tools: Vec<String>,
    pub child_client_tools: Vec<String>,
}

/// Compare-and-set: the first stream of a binding wins; another takes over
/// once the holder's lease has expired, or at once when it is a later stream
/// of the holder's instance.
pub async fn acquire(
    db: &DatabaseConnection,
    claim: &PresenceClaim,
    stream_id: Uuid,
) -> Result<bool, Report> {
    Ok(db
        .execute_raw(statement(
            r#"INSERT INTO client_executor_presence AS p
               (account_id, binding, stream_id, instance_id, connected_at, client_tools,
                child_client_tools, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '20 seconds')
             ON CONFLICT (account_id, binding) DO UPDATE SET stream_id = EXCLUDED.stream_id,
               instance_id = EXCLUDED.instance_id,
               connected_at = EXCLUDED.connected_at,
               client_tools = EXCLUDED.client_tools,
               child_client_tools = EXCLUDED.child_client_tools,
               expires_at = EXCLUDED.expires_at
             WHERE p.expires_at <= now() OR p.stream_id = EXCLUDED.stream_id
               OR (p.instance_id = EXCLUDED.instance_id
                   AND p.connected_at < EXCLUDED.connected_at)"#,
            vec![
                claim.account_id.into(),
                serde_json::to_value(&claim.binding)?.into(),
                stream_id.into(),
                claim.instance_id.into(),
                claim.connected_at.into(),
                serde_json::to_value(&claim.client_tools)?.into(),
                serde_json::to_value(&claim.child_client_tools)?.into(),
            ],
        ))
        .await?
        .rows_affected()
        == 1)
}

/// The row a waiting stream compares itself with, read without a lock.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Holder {
    stream_id: Uuid,
    instance_id: Option<Uuid>,
    connected_at: DateTime<Utc>,
    live: bool,
}

async fn holder(db: &DatabaseConnection, claim: &PresenceClaim) -> Result<Option<Holder>, Report> {
    db.query_one_raw(statement(
        r#"SELECT stream_id, instance_id, connected_at, expires_at > now() AS live
           FROM client_executor_presence WHERE account_id = $1 AND binding = $2"#,
        vec![
            claim.account_id.into(),
            serde_json::to_value(&claim.binding)?.into(),
        ],
    ))
    .await?
    .map(|row| -> Result<Holder, Report> {
        Ok(Holder {
            stream_id: row.try_get("", "stream_id")?,
            instance_id: row.try_get("", "instance_id")?,
            connected_at: row.try_get("", "connected_at")?,
            live: row.try_get("", "live")?,
        })
    })
    .transpose()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Standby {
    Acquire,
    Wait,
    /// A later stream of this stream's instance holds the binding.
    Superseded,
}

impl PresenceClaim {
    /// Mirrors `acquire`'s condition, so a waiting stream writes only when it
    /// can win: a rejected upsert still locks the row and uses a transaction id.
    fn standby(&self, stream_id: Uuid, holder: Option<&Holder>) -> Standby {
        let Some(holder) = holder else {
            return Standby::Acquire;
        };
        if !holder.live || holder.stream_id == stream_id {
            return Standby::Acquire;
        }
        match (self.instance_id, holder.instance_id) {
            (Some(mine), Some(theirs)) if mine == theirs => {
                if holder.connected_at < self.connected_at {
                    Standby::Acquire
                } else {
                    Standby::Superseded
                }
            }
            _ => Standby::Wait,
        }
    }

    async fn acquire(&self, db: &DatabaseConnection, stream_id: Uuid) -> bool {
        acquire(db, self, stream_id).await.unwrap_or_else(|error| {
            tracing::warn!(%error, "Executor stream presence acquisition failed; will retry");
            false
        })
    }
}

/// Spread out, so the waiting streams of many panes don't poll in step.
fn standby_retry() -> Duration {
    Duration::from_millis(rand::random_range(1_000..2_000))
}

pub async fn renew(db: &DatabaseConnection, stream_id: Uuid) -> Result<bool, Report> {
    Ok(db
        .execute_raw(statement(
            r#"UPDATE client_executor_presence SET expires_at = now() + interval '20 seconds'
             WHERE stream_id = $1 AND expires_at > now()"#,
            vec![stream_id.into()],
        ))
        .await?
        .rows_affected()
        == 1)
}

pub async fn release(db: &DatabaseConnection, stream_id: Uuid) -> Result<(), Report> {
    db.execute_raw(statement(
        "DELETE FROM client_executor_presence WHERE stream_id = $1",
        vec![stream_id.into()],
    ))
    .await?;
    Ok(())
}

/// The stream serving the binding, with the tool names (including the
/// child-capable ones) it advertised.
pub async fn present(
    db: &DatabaseConnection,
    account_id: Uuid,
    binding: &ExecutorBinding,
) -> Result<Option<ExecutorPresence>, Report> {
    let Some(row) = db
        .query_one_raw(statement(
            r#"SELECT stream_id, client_tools, child_client_tools FROM client_executor_presence
             WHERE account_id = $1 AND binding = $2 AND expires_at > now()"#,
            vec![account_id.into(), serde_json::to_value(binding)?.into()],
        ))
        .await?
    else {
        return Ok(None);
    };
    Ok(Some(ExecutorPresence {
        stream_id: row.try_get("", "stream_id")?,
        client_tools: serde_json::from_value(row.try_get("", "client_tools")?)?,
        child_client_tools: serde_json::from_value(row.try_get("", "child_client_tools")?)?,
    }))
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
             (account_id, binding, chat_id, message_id, tool_call_id, generation_id, event)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (message_id, tool_call_id) WHERE attempt_id IS NULL
           DO UPDATE SET account_id = EXCLUDED.account_id, binding = EXCLUDED.binding,
             chat_id = EXCLUDED.chat_id, generation_id = EXCLUDED.generation_id,
             event = EXCLUDED.event, created_at = now(), delivered_at = NULL, delivered_to = NULL"#,
        vec![
            call.account_id.into(),
            serde_json::to_value(&call.binding)?.into(),
            call.chat_id.into(),
            call.message_id.into(),
            call.tool_call_id.clone().into(),
            call.generation_id.into(),
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

/// Returns once the binding has had no stream for [`PRESENCE_LOSS_GRACE`]. A
/// reconnecting stream resets the grace; a failed lookup counts as present.
pub async fn wait_for_presence_loss(
    db: &DatabaseConnection,
    account_id: Uuid,
    binding: &ExecutorBinding,
) {
    let mut absent_since = None;
    loop {
        match present(db, account_id, binding).await {
            Ok(Some(_)) => absent_since = None,
            Ok(None) => {
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
                    r#"UPDATE client_executor_calls SET delivered_at = NULL, delivered_to = NULL
                       WHERE call_id = ANY($1::bigint[])"#,
                    vec![undelivered.into()],
                ))
                .await
        {
            tracing::warn!(%error, "Failed to requeue executor stream calls");
        }
    }
}

/// Marks every due row for a presence held here as delivered to that stream.
/// A live call is due while its run is running, until the stream that now
/// holds its binding has had it: a pane that reloads or reconnects gets it
/// again, since the event may have died with the old stream. A nudge is due
/// once, when its attempt is claimable: pending, its chat not running.
async fn claim(
    db: &DatabaseConnection,
    streams: &[Uuid],
) -> Result<Vec<(i64, Uuid, ExecutorStreamEvent)>, Report> {
    db.query_all_raw(statement(
        r#"WITH due AS (
             SELECT q.call_id, p.stream_id FROM client_executor_calls q
             JOIN client_executor_presence p
               ON p.account_id = q.account_id AND p.binding = q.binding
             WHERE p.stream_id = ANY($1::uuid[]) AND p.expires_at > now()
               AND CASE WHEN q.attempt_id IS NULL THEN q.delivered_to IS DISTINCT FROM p.stream_id
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
           UPDATE client_executor_calls q SET delivered_at = now(), delivered_to = due.stream_id
           FROM due WHERE q.call_id = due.call_id
           RETURNING q.call_id, due.stream_id, q.event"#,
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

/// A stream's claim on its binding. It holds presence from connect, renews it
/// every heartbeat and, while another stream holds it, checks again every one
/// to two seconds. Only a holder receives calls. A stream that a later stream
/// of its own instance took the binding from ends. Dropping the guard releases
/// the binding.
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
        let held = claim.acquire(&db, stream_id).await;
        if held {
            hub.register(&db, stream_id, sender.clone());
        }
        let heartbeat = tokio::spawn(heartbeat(
            db.clone(),
            hub.clone(),
            claim,
            stream_id,
            sender,
            held,
        ));
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

async fn heartbeat(
    db: DatabaseConnection,
    hub: ExecutorStreamHub,
    claim: PresenceClaim,
    stream_id: Uuid,
    sender: StreamSender,
    mut held: bool,
) {
    loop {
        tokio::time::sleep(if held { HEARTBEAT } else { standby_retry() }).await;
        if sender.is_closed() {
            return;
        }
        if held {
            match renew(&db, stream_id).await {
                Ok(true) => continue,
                Ok(false) => {
                    held = false;
                    hub.unregister(stream_id);
                }
                Err(error) => {
                    tracing::warn!(%error, "Executor stream heartbeat failed");
                    continue;
                }
            }
        }
        let current = match holder(&db, &claim).await {
            Ok(current) => current,
            Err(error) => {
                tracing::warn!(%error, "Executor stream presence lookup failed; will retry");
                continue;
            }
        };
        match claim.standby(stream_id, current.as_ref()) {
            Standby::Acquire => {
                if claim.acquire(&db, stream_id).await {
                    held = true;
                    hub.register(&db, stream_id, sender.clone());
                }
            }
            Standby::Wait => {}
            // Dropping the last sender ends the response.
            Standby::Superseded => return,
        }
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
    fn a_waiting_stream_writes_only_when_it_can_win() {
        let now = Utc::now();
        let (earlier, later) = (
            now - chrono::Duration::seconds(30),
            now + chrono::Duration::seconds(30),
        );
        let instance = Some(Uuid::new_v4());
        let claim = |instance_id| PresenceClaim {
            account_id: Uuid::nil(),
            binding: ExecutorBinding {
                device_id: "device".into(),
                realm: super::super::ExecutionRealm::OfficeAddin,
                host_context: None,
            },
            instance_id,
            connected_at: now,
            client_tools: Vec::new(),
            child_client_tools: Vec::new(),
        };
        let held = |instance_id, connected_at, live| Holder {
            stream_id: Uuid::new_v4(),
            instance_id,
            connected_at,
            live,
        };
        let me = Uuid::new_v4();
        let standby = |claim: &PresenceClaim, holder: Holder| claim.standby(me, Some(&holder));
        let mine = claim(instance);

        assert_eq!(mine.standby(me, None), Standby::Acquire);
        assert_eq!(standby(&mine, held(None, earlier, false)), Standby::Acquire);
        let own = Holder {
            stream_id: me,
            ..held(instance, now, true)
        };
        assert_eq!(standby(&mine, own), Standby::Acquire);
        assert_eq!(
            standby(&mine, held(instance, earlier, true)),
            Standby::Acquire
        );
        assert_eq!(
            standby(&mine, held(instance, later, true)),
            Standby::Superseded
        );
        assert_eq!(
            standby(&mine, held(instance, now, true)),
            Standby::Superseded
        );
        let other = Some(Uuid::new_v4());
        assert_eq!(standby(&mine, held(other, earlier, true)), Standby::Wait);
        assert_eq!(standby(&mine, held(None, earlier, true)), Standby::Wait);
        assert_eq!(
            standby(&claim(None), held(None, earlier, true)),
            Standby::Wait
        );
    }
}
