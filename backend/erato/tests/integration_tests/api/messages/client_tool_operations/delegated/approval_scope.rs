//! Context approvals (ERMAIN-1033): one decision on the parent's card lets a
//! task's granted read run under an approval for the document (checked by the
//! pane) or the response (kept by the server alone).
use super::*;
use erato::config::{ClientToolApprovalScope, ClientToolHostContext};
use sea_orm::ConnectionTrait;

fn read_with_context_scope(row: &HostRow, config: &mut erato::config::AppConfig) {
    let mut tool = row.read_config(false, None);
    tool.approval_scope = ClientToolApprovalScope::Context;
    config.client_tools.tools.insert(READ_KEY.into(), tool);
}

/// A parent with one client task whose read asks first, parked on the task's
/// item; the pane checks approval scopes when `scoped`.
async fn ask_with_scope(row: &HostRow, pool: Pool<Postgres>, scoped: bool) -> AskedChild {
    let (parent, child) = (RequestBodyRecorder::new(), RequestBodyRecorder::new());
    let mut mocks = MockSet::new();
    mock_parent(&mut mocks, &parent, vec![client_task(None)]);
    mock_client_child_reads(row, &mut mocks, &child);
    let (state, llm) = delegated_state(row, pool, mocks, |config| {
        read_with_context_scope(row, config)
    })
    .await;
    ask_before_reads(row, &state).await;
    let (base, server) = serve(&state).await;
    let mut pane = if scoped {
        Pane::open_scoped(
            &base,
            &row.binding(),
            &row.pane_tools(),
            row.child_pane_tools(),
            row.read_tool,
        )
        .await
    } else {
        open_pane(row, &base).await
    };
    let chat_id = seed_origin_chat(&state.db).await;
    finish(spawn_parent(
        row,
        &base,
        chat_id,
        ACTION_FACET,
        Some(row.binding()),
    ))
    .await;
    assert_eq!(pane.next(Duration::from_millis(300)).await, None);
    let child_chat = child_chat(&state.db, chat_id, CHILD_FACET).await.unwrap();
    AskedChild {
        parent_message: assistant_row(&state.db, chat_id).await,
        state,
        base,
        server,
        _llm: llm,
        pane,
        chat_id,
        child: child_chat,
        recorder: child,
    }
}

/// [`spawn_decision`] sent with an executor binding, as the pane sends it.
fn spawn_decision_from(
    base: &str,
    body: Value,
    executor: &ExecutorBinding,
) -> tokio::task::JoinHandle<String> {
    let request = reqwest::Client::new()
        .post(format!("{base}/me/messages/continuestream"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("X-Erato-Executor", serde_json::to_string(executor).unwrap())
        .json(&body);
    tokio::spawn(async move {
        let response = request.send().await.unwrap();
        let status = response.status();
        let received = response.text().await.unwrap();
        assert!(status.is_success(), "{status}: {received}");
        received
    })
}

/// The chat's approval rows as `(position, decided_in_message_id, ended)`.
async fn approvals(
    state: &erato::state::AppState,
    chat_id: Uuid,
) -> Vec<(Option<Value>, Uuid, bool)> {
    state
        .db
        .query_all_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT position, decided_in_message_id, ended_at IS NOT NULL AS ended
               FROM client_tool_approval_scopes WHERE chat_id = $1 ORDER BY created_at"#,
            vec![chat_id.into()],
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "position").unwrap(),
                row.try_get("", "decided_in_message_id").unwrap(),
                row.try_get("", "ended").unwrap(),
            )
        })
        .collect()
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_document_approval_from_the_pane_runs_the_read_under_one_approval(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut asked = ask_with_scope(row, pool, true).await;
    let request = parked_part(&asked.parent_message);
    let item = &request["approvals"][0];
    assert_eq!(
        item["child"]["approval_scope"],
        json!({"host_context": "word_document", "covers": "document", "scope_id": row.identity})
    );
    let position = json!({"journal": "journal-1", "seq": 41, "events": true});
    let body = |position: Value| {
        json!({
            "message_id": asked.parent_message.id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve_context",
                           "scope_position": position}],
            "shows_child_items": true,
        })
    };
    // Only the pane holding the document can allow it, with its position.
    let refused = app_server(asked.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&body(position.clone()))
        .await;
    refused.assert_status(axum::http::StatusCode::BAD_REQUEST);
    assert!(approvals(&asked.state, asked.chat_id).await.is_empty());

    let decided = spawn_decision_from(&asked.base, body(position.clone()), &row.binding());
    let event = asked.pane.call().await;
    let stored = approvals(&asked.state, asked.chat_id).await;
    assert_eq!(
        stored,
        vec![(Some(position.clone()), asked.parent_message.id, false)]
    );
    let scope = &event["lineage"]["approval_scope"];
    assert_eq!(scope["scope_id"], row.identity);
    assert_eq!(scope["position"], position);
    assert!(scope["approval_id"].is_string());
    answer_call(row, &asked.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    let child_row = assistant_row(&asked.state.db, asked.child.id).await;
    assert!(
        child_row.raw_message["content"]
            .as_array()
            .unwrap()
            .iter()
            .any(|part| part["content_type"] == "tool_approval"
                && part["covers"] == "document"
                && part["scope_approval_id"] == scope["approval_id"])
    );
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_response_approval_runs_the_read_without_a_scope_in_its_lineage(pool: Pool<Postgres>) {
    let row = &rows::fake_live_host(ClientToolHostContext::OutlookMailbox);
    let mut asked = ask_with_scope(row, pool, false).await;
    let request = parked_part(&asked.parent_message);
    let item = &request["approvals"][0];
    assert_eq!(
        item["child"]["approval_scope"],
        json!({"host_context": "outlook_mailbox", "covers": "turn",
               "scope_id": asked.parent_message.id.to_string()})
    );
    let decided = spawn_decision(
        &asked.base,
        json!({
            "message_id": asked.parent_message.id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve_context"}],
            "shows_child_items": true,
        }),
    );
    let event = asked.pane.call().await;
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    answer_call(row, &asked.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert_eq!(
        approvals(&asked.state, asked.chat_id).await,
        vec![(None, asked.parent_message.id, false)]
    );
    asked.server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_pane_that_does_not_check_scopes_offers_no_document_scope(pool: Pool<Postgres>) {
    let row = &rows::fake_host(ClientToolHostContext::WordDocument);
    let mut asked = ask_with_scope(row, pool, false).await;
    let request = parked_part(&asked.parent_message);
    let item = &request["approvals"][0];
    assert!(item["child"].get("approval_scope").is_none(), "{item}");
    let refused = app_server(asked.state.clone())
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "message_id": asked.parent_message.id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve_context"}],
            "shows_child_items": true,
        }))
        .await;
    refused.assert_status(axum::http::StatusCode::BAD_REQUEST);
    let decided = spawn_decision(
        &asked.base,
        json!({
            "message_id": asked.parent_message.id,
            "decisions": [{"approval_id": item["approval_id"], "decision": "approve"}],
            "shows_child_items": true,
        }),
    );
    let event = asked.pane.call().await;
    assert!(event["lineage"].get("approval_scope").is_none(), "{event}");
    answer_call(row, &asked.state, &event).await;
    assert!(finish(decided).await.contains(PARENT_FINAL));
    assert!(approvals(&asked.state, asked.chat_id).await.is_empty());
    asked.server.abort();
}
