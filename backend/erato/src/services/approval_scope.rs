//! Context approvals (ERMAIN-1033): one decision in the parent chat that lets
//! every task call of one tool on the same document or turn run without asking,
//! until the host reports an outside change. Only tool approvals: the host's
//! own prompts and release reviews never pass through here.
use crate::models::chat::ClientToolGrant;
use crate::models::message::{ApprovalScope, ApprovalScopeCovers};
use crate::query_metrics::named_statement_from_sql_and_values;
use crate::services::client_operations::ExecutorBinding;
use erato_config::config::{ClientToolApprovalScope, ClientToolConfig, ClientToolHostContext};
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The validation code a host answers a covered call with, without reading,
/// when the scope changed outside the chat since the decision (contract §6).
pub const SCOPE_CHANGED: &str = "scope_changed";

pub const END_SCOPE_CHANGED: &str = SCOPE_CHANGED;
pub const END_CHAT_ARCHIVED: &str = "chat_archived";
pub const END_SUPERSEDED: &str = "superseded";
pub const END_NEVER_ALLOWED: &str = "never_allowed";

const MAX_POSITION_BYTES: usize = 1024;
const MAX_SCOPE_ID_CHARS: usize = 256;

fn statement(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    named_statement_from_sql_and_values(
        DatabaseBackend::Postgres,
        "services.approval_scope",
        sql,
        values,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalScopeKind {
    /// The document in one pane session; the pane checks its change journal.
    PaneDocument,
    /// The parent turn; the server alone ends it with the turn.
    ParentTurn,
}

/// The scope a host context's tools may be approved for, if any. None for the
/// desktop sidecar, whose calls always ask (config refuses `context` there).
pub fn kind(host: ClientToolHostContext) -> Option<ApprovalScopeKind> {
    match host {
        ClientToolHostContext::WordDocument => Some(ApprovalScopeKind::PaneDocument),
        ClientToolHostContext::OutlookMailbox => Some(ApprovalScopeKind::ParentTurn),
        ClientToolHostContext::DesktopSidecar => None,
    }
}

pub fn covers(kind: ApprovalScopeKind) -> ApprovalScopeCovers {
    match kind {
        ApprovalScopeKind::PaneDocument => ApprovalScopeCovers::Document,
        ApprovalScopeKind::ParentTurn => ApprovalScopeCovers::Turn,
    }
}

/// Whether the host checks the scope before reading, against the position
/// taken at the decision.
pub fn device_checked(kind: ApprovalScopeKind) -> bool {
    match kind {
        ApprovalScopeKind::PaneDocument => true,
        ApprovalScopeKind::ParentTurn => false,
    }
}

/// Lowercase hex SHA-256 of the binding's JSON, so one device's or host
/// instance's approval never serves another, whatever the scope id.
pub fn binding_digest(binding: &ExecutorBinding) -> String {
    let bytes = serde_json::to_vec(binding).expect("an executor binding serializes");
    Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScopeKey {
    pub host_context: ClientToolHostContext,
    pub kind: ApprovalScopeKind,
    pub binding_digest: String,
    pub scope_id: String,
    /// Qualified (`namespace/name`).
    pub tool_name: String,
}

impl ScopeKey {
    pub fn device_checked(&self) -> bool {
        device_checked(self.kind)
    }

    /// The scope as an approval item shows it.
    pub fn approval_scope(&self, changed: bool) -> ApprovalScope {
        ApprovalScope {
            host_context: self.host_context.as_str().to_string(),
            covers: covers(self.kind),
            scope_id: self.scope_id.clone(),
            changed,
        }
    }
}

/// The key a granted call of this tool is approved under, computed from the
/// grant and the current config only. `None` for a `call` tool, a host without
/// an approval scope, or a grant whose binding is not of the tool's host.
pub fn key_for_grant(config: &ClientToolConfig, grant: &ClientToolGrant) -> Option<ScopeKey> {
    if config.approval_scope != ClientToolApprovalScope::Context {
        return None;
    }
    let host = config.host_context?;
    let kind = kind(host)?;
    let binding_context = grant.binding.host_context.as_ref()?;
    if binding_context.kind != host.as_str() {
        return None;
    }
    let scope_id = match kind {
        ApprovalScopeKind::PaneDocument => binding_context.identity.clone(),
        ApprovalScopeKind::ParentTurn => grant.owner_message_id.to_string(),
    };
    if scope_id.is_empty() || scope_id.chars().count() > MAX_SCOPE_ID_CHARS {
        return None;
    }
    Some(ScopeKey {
        host_context: host,
        kind,
        binding_digest: binding_digest(&grant.binding),
        scope_id,
        tool_name: config.qualified_name(),
    })
}

/// Server-side check of a decision's position for a scope checked on the
/// device: an object of at most 1 KiB in the host's shape. The host alone
/// interprets it.
pub fn position_acceptable(key: &ScopeKey, position: &Value) -> bool {
    let Some(object) = position.as_object() else {
        return false;
    };
    if serde_json::to_vec(position).map_or(true, |bytes| bytes.len() > MAX_POSITION_BYTES) {
        return false;
    }
    match key.host_context {
        ClientToolHostContext::WordDocument => {
            object.get("journal").is_some_and(Value::is_string)
                && object
                    .get("seq")
                    .is_some_and(|seq| seq.is_u64() || seq.is_i64())
                && object.get("events") == Some(&Value::Bool(true))
        }
        ClientToolHostContext::OutlookMailbox | ClientToolHostContext::DesktopSidecar => false,
    }
}

/// A validated `approve_context` decision on one approval item.
#[derive(Clone, Debug, PartialEq)]
pub struct ContextDecision {
    pub key: ScopeKey,
    /// The host's position at the click; set only for scopes checked on the device.
    pub position: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LiveApproval {
    pub id: Uuid,
    pub position: Option<Value>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Lookup {
    pub live: Option<LiveApproval>,
    /// Why the key's latest approval ended, when none is live.
    pub last_end: Option<String>,
}

impl Lookup {
    pub fn ended_by_change(&self) -> bool {
        self.live.is_none() && self.last_end.as_deref() == Some(END_SCOPE_CHANGED)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ApprovalState {
    Live(LiveApproval),
    Ended { reason: String },
}

fn key_values(chat_id: Uuid, key: &ScopeKey) -> Vec<sea_orm::Value> {
    vec![
        chat_id.into(),
        key.binding_digest.clone().into(),
        key.host_context.as_str().into(),
        key.scope_id.clone().into(),
        key.tool_name.clone().into(),
    ]
}

const KEY_MATCHES: &str = "s.chat_id = $1 AND s.binding_digest = $2 AND s.host_context = $3 \
     AND s.scope_id = $4 AND s.tool_name = $5";

/// The key's live approval in a chat that is not archived, and otherwise why
/// its latest one ended.
pub async fn lookup(
    db: &DatabaseConnection,
    chat_id: Uuid,
    key: &ScopeKey,
) -> Result<Lookup, Report> {
    let Some(row) = db
        .query_one_raw(statement(
            &format!(
                r#"SELECT s.id, s.position, s.ended_at IS NULL AS live, s.end_reason
                   FROM client_tool_approval_scopes s JOIN chats c ON c.id = s.chat_id
                   WHERE {KEY_MATCHES} AND c.archived_at IS NULL
                   ORDER BY (s.ended_at IS NULL) DESC, s.created_at DESC
                   LIMIT 1"#
            ),
            key_values(chat_id, key),
        ))
        .await?
    else {
        return Ok(Lookup::default());
    };
    if row.try_get::<bool>("", "live")? {
        return Ok(Lookup {
            live: Some(LiveApproval {
                id: row.try_get("", "id")?,
                position: row.try_get("", "position")?,
            }),
            last_end: None,
        });
    }
    Ok(Lookup {
        live: None,
        last_end: row.try_get("", "end_reason")?,
    })
}

/// The state of the approval a context-approved call was decided under. An
/// approval of an archived chat counts as ended.
pub async fn by_id(
    db: &DatabaseConnection,
    approval_id: Uuid,
) -> Result<Option<ApprovalState>, Report> {
    let Some(row) = db
        .query_one_raw(statement(
            r#"SELECT s.id, s.position, s.ended_at IS NULL AS live, s.end_reason,
                      c.archived_at IS NOT NULL AS archived
               FROM client_tool_approval_scopes s JOIN chats c ON c.id = s.chat_id
               WHERE s.id = $1"#,
            vec![approval_id.into()],
        ))
        .await?
    else {
        return Ok(None);
    };
    if row.try_get::<bool>("", "archived")? {
        return Ok(Some(ApprovalState::Ended {
            reason: END_CHAT_ARCHIVED.to_string(),
        }));
    }
    if row.try_get::<bool>("", "live")? {
        return Ok(Some(ApprovalState::Live(LiveApproval {
            id: row.try_get("", "id")?,
            position: row.try_get("", "position")?,
        })));
    }
    Ok(Some(ApprovalState::Ended {
        reason: row
            .try_get::<Option<String>>("", "end_reason")?
            .unwrap_or_default(),
    }))
}

/// A decision is its stop and the position taken at its click: the same body
/// sent again is the same decision, a new click on the same stop is another.
const DECISION_MATCHES: &str = "s.decided_in_message_id = $6 AND s.decided_stop = $7 \
     AND s.position IS NOT DISTINCT FROM $8";

fn decision_values(
    chat_id: Uuid,
    key: &ScopeKey,
    decided_in: Uuid,
    decided_stop: i32,
    position: Option<&Value>,
) -> Vec<sea_orm::Value> {
    let mut values = key_values(chat_id, key);
    values.push(decided_in.into());
    values.push(decided_stop.into());
    values.push(position.cloned().into());
    values
}

async fn decided_row(
    db: &DatabaseConnection,
    chat_id: Uuid,
    key: &ScopeKey,
    decided_in: Uuid,
    decided_stop: i32,
    position: Option<&Value>,
) -> Result<Option<Uuid>, Report> {
    db.query_one_raw(statement(
        &format!(
            r#"SELECT s.id FROM client_tool_approval_scopes s
               WHERE {KEY_MATCHES} AND {DECISION_MATCHES}"#
        ),
        decision_values(chat_id, key, decided_in, decided_stop, position),
    ))
    .await?
    .map(|row| row.try_get("", "id").map_err(Report::from))
    .transpose()
}

/// The approval one decision made: the row it already made, live or ended, or
/// a new live row. A crash retry of the same body finds the same row, so a
/// decision never makes a second one; a new click on the stop after a crash
/// carries a new position and makes a new approval, which replaces a live one.
pub async fn approve_for_decision(
    db: &DatabaseConnection,
    chat_id: Uuid,
    key: &ScopeKey,
    decided_in: Uuid,
    decided_stop: i32,
    position: Option<&Value>,
) -> Result<Uuid, Report> {
    for _ in 0..3 {
        if let Some(id) = decided_row(db, chat_id, key, decided_in, decided_stop, position).await? {
            return Ok(id);
        }
        let mut values = vec![Uuid::new_v4().into()];
        values.extend(decision_values(
            chat_id,
            key,
            decided_in,
            decided_stop,
            position,
        ));
        if let Some(row) = db
            .query_one_raw(statement(
                r#"INSERT INTO client_tool_approval_scopes
                     (id, chat_id, binding_digest, host_context, scope_id, tool_name,
                      decided_in_message_id, decided_stop, position)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   ON CONFLICT DO NOTHING
                   RETURNING id"#,
                values,
            ))
            .await?
        {
            return Ok(row.try_get("", "id")?);
        }
        // Another decision's approval is live: the newer decision replaces it.
        db.execute_raw(statement(
            &format!(
                r#"UPDATE client_tool_approval_scopes s SET ended_at = now(), end_reason = $9
                   WHERE {KEY_MATCHES} AND s.ended_at IS NULL AND NOT ({DECISION_MATCHES})"#
            ),
            {
                let mut values = decision_values(chat_id, key, decided_in, decided_stop, position);
                values.push(END_SUPERSEDED.into());
                values
            },
        ))
        .await?;
    }
    Err(eyre::eyre!("Cannot record an approval for its decision"))
}

/// Ends one approval; a late end for an older approval never ends a newer one.
pub async fn end(db: &DatabaseConnection, approval_id: Uuid, reason: &str) -> Result<bool, Report> {
    let result = db
        .execute_raw(statement(
            r#"UPDATE client_tool_approval_scopes SET ended_at = now(), end_reason = $2
               WHERE id = $1 AND ended_at IS NULL"#,
            vec![approval_id.into(), reason.into()],
        ))
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Ends the user's live approvals of these tools in every chat they own, so a
/// later Ask never brings back an approval given before Never.
pub async fn end_for_tools(
    db: &DatabaseConnection,
    owner_user_id: Uuid,
    tool_names: &[String],
    reason: &str,
) -> Result<u64, Report> {
    if tool_names.is_empty() {
        return Ok(0);
    }
    let result = db
        .execute_raw(statement(
            r#"UPDATE client_tool_approval_scopes s SET ended_at = now(), end_reason = $3
               FROM chats c
               WHERE c.id = s.chat_id AND c.owner_user_id = $1 AND s.ended_at IS NULL
                 AND s.tool_name IN (SELECT jsonb_array_elements_text($2))"#,
            vec![
                owner_user_id.to_string().into(),
                serde_json::json!(tool_names).into(),
                reason.into(),
            ],
        ))
        .await?;
    Ok(result.rows_affected())
}

/// Ends every live approval of a chat.
pub async fn end_for_chat(
    db: &DatabaseConnection,
    chat_id: Uuid,
    reason: &str,
) -> Result<u64, Report> {
    let result = db
        .execute_raw(statement(
            r#"UPDATE client_tool_approval_scopes SET ended_at = now(), end_reason = $2
               WHERE chat_id = $1 AND ended_at IS NULL"#,
            vec![chat_id.into(), reason.into()],
        ))
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::client_operations::{ExecutionRealm, HostContext};
    use serde_json::json;

    fn binding(device: &str, kind: &str, identity: &str) -> ExecutorBinding {
        ExecutorBinding {
            device_id: device.into(),
            realm: ExecutionRealm::OfficeAddin,
            host_context: Some(HostContext {
                kind: kind.into(),
                identity: identity.into(),
            }),
        }
    }

    fn grant(binding: ExecutorBinding) -> ClientToolGrant {
        ClientToolGrant {
            tools: vec!["word/read".into()],
            durable_tools: Vec::new(),
            binding,
            owner_chat_id: Uuid::new_v4(),
            owner_message_id: Uuid::new_v4(),
            context_ref: None,
        }
    }

    fn tool(host: ClientToolHostContext, scope: ClientToolApprovalScope) -> ClientToolConfig {
        ClientToolConfig {
            name: "read".into(),
            namespace: Some("word".into()),
            host_context: Some(host),
            approval_scope: scope,
            ..Default::default()
        }
    }

    #[test]
    fn kinds_and_covers_follow_the_host_context() {
        assert_eq!(
            kind(ClientToolHostContext::WordDocument),
            Some(ApprovalScopeKind::PaneDocument)
        );
        assert_eq!(
            kind(ClientToolHostContext::OutlookMailbox),
            Some(ApprovalScopeKind::ParentTurn)
        );
        assert_eq!(kind(ClientToolHostContext::DesktopSidecar), None);
        assert_eq!(
            covers(ApprovalScopeKind::PaneDocument),
            ApprovalScopeCovers::Document
        );
        assert_eq!(
            covers(ApprovalScopeKind::ParentTurn),
            ApprovalScopeCovers::Turn
        );
        assert!(device_checked(ApprovalScopeKind::PaneDocument));
        assert!(!device_checked(ApprovalScopeKind::ParentTurn));
    }

    #[test]
    fn binding_digest_is_stable_and_names_the_device_and_identity() {
        let one = binding("device-1", "word_document", "identity-1");
        assert_eq!(binding_digest(&one), binding_digest(&one.clone()));
        assert_eq!(binding_digest(&one).len(), 64);
        assert!(
            binding_digest(&one)
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
        );
        assert_ne!(
            binding_digest(&one),
            binding_digest(&binding("device-2", "word_document", "identity-1"))
        );
        assert_ne!(
            binding_digest(&one),
            binding_digest(&binding("device-1", "word_document", "identity-2"))
        );
    }

    #[test]
    fn key_for_grant_per_host_context_and_a_call_tool() {
        let word = grant(binding("device", "word_document", "identity"));
        let key = key_for_grant(
            &tool(
                ClientToolHostContext::WordDocument,
                ClientToolApprovalScope::Context,
            ),
            &word,
        )
        .expect("a context tool on its own host has a key");
        assert_eq!(key.kind, ApprovalScopeKind::PaneDocument);
        assert_eq!(key.scope_id, "identity");
        assert_eq!(key.tool_name, "word/read");
        assert_eq!(key.binding_digest, binding_digest(&word.binding));

        let outlook = grant(binding("device", "outlook_mailbox", "mailbox"));
        let key = key_for_grant(
            &tool(
                ClientToolHostContext::OutlookMailbox,
                ClientToolApprovalScope::Context,
            ),
            &outlook,
        )
        .expect("a context tool on Outlook has a key");
        assert_eq!(key.kind, ApprovalScopeKind::ParentTurn);
        assert_eq!(key.scope_id, outlook.owner_message_id.to_string());

        assert_eq!(
            key_for_grant(
                &tool(
                    ClientToolHostContext::WordDocument,
                    ClientToolApprovalScope::Call
                ),
                &word,
            ),
            None
        );
        assert_eq!(
            key_for_grant(
                &tool(
                    ClientToolHostContext::WordDocument,
                    ClientToolApprovalScope::Context
                ),
                &outlook,
            ),
            None
        );
    }

    #[test]
    fn position_acceptable_takes_only_a_small_word_position_with_events() {
        let key = key_for_grant(
            &tool(
                ClientToolHostContext::WordDocument,
                ClientToolApprovalScope::Context,
            ),
            &grant(binding("device", "word_document", "identity")),
        )
        .unwrap();
        assert!(position_acceptable(
            &key,
            &json!({"journal": "j-1", "seq": 41, "events": true})
        ));
        assert!(!position_acceptable(
            &key,
            &json!({"journal": "j-1", "seq": 41, "events": false})
        ));
        assert!(!position_acceptable(
            &key,
            &json!({"journal": "j-1", "seq": "41", "events": true})
        ));
        assert!(!position_acceptable(
            &key,
            &json!({"journal": 1, "seq": 41, "events": true})
        ));
        assert!(!position_acceptable(
            &key,
            &json!({"journal": "j-1", "seq": 41, "events": true, "pad": "x".repeat(1024)})
        ));
        assert!(!position_acceptable(&key, &json!(["j-1", 41, true])));
        assert!(!position_acceptable(&key, &json!("j-1")));

        let turn = key_for_grant(
            &tool(
                ClientToolHostContext::OutlookMailbox,
                ClientToolApprovalScope::Context,
            ),
            &grant(binding("device", "outlook_mailbox", "mailbox")),
        )
        .unwrap();
        assert!(!position_acceptable(
            &turn,
            &json!({"journal": "j-1", "seq": 41, "events": true})
        ));
    }
}
