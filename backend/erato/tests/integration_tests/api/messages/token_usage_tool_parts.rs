//! The estimate must see what the provider will be sent, including replayed
//! tool calls and responses, or a client preflight approves requests that
//! overflow the model context.
use super::*;

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn a_replayed_tool_response_counts_toward_history_tokens(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state.clone());
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");

    server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "previous_message_id": null, "user_message": "Read the document." }))
        .await
        .assert_status_ok();
    let assistant = Messages::find()
        .order_by_desc(erato::db::entity::messages::Column::CreatedAt)
        .one(&app_state.db)
        .await
        .unwrap()
        .expect("assistant message");
    assert_eq!(assistant.raw_message["role"], "assistant");

    let history_tokens = |server: &TestServer| {
        let request = server
            .post("/api/v1beta/token_usage/estimate")
            .with_bearer_token(TEST_JWT_TOKEN)
            .json(&json!({
                "previous_message_id": assistant.id,
                "user_message": "What did it say?",
            }));
        async move {
            let response = request.await;
            response.assert_status_ok();
            response.json::<Value>()["stats"]["history_tokens"]
                .as_u64()
                .expect("history_tokens")
        }
    };
    let before = history_tokens(&server).await;

    let page = "The quarterly report covers revenue and staffing. ".repeat(4200);
    assert!(page.len() > 200 * 1024);
    let mut raw_message = assistant.raw_message.clone();
    raw_message["content"].as_array_mut().unwrap().insert(
        0,
        json!({
            "content_type": "tool_use",
            "tool_call_id": "call_read",
            "status": "success",
            "tool_name": "read_document_blocks",
            "progress_message": null,
            "input": {"snapshot": "s1"},
            "output": {"status": "success", "result": {"blocks": [{"text": page}]}},
        }),
    );
    let mut active: erato::db::entity::messages::ActiveModel = assistant.clone().into();
    active.raw_message = ActiveValue::Set(raw_message);
    active.update(&app_state.db).await.unwrap();

    let after = history_tokens(&server).await;
    assert!(
        after > before + 30_000,
        "a ~200 KiB replayed tool response must be counted: {before} -> {after}"
    );
}
