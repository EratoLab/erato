use super::*;

async fn budget_choice(pool: Pool<Postgres>, decision: &str, extensions: usize) {
    let recorder = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    let final_recorder = recorder.clone();
    mocks.mock(move |when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[READ_FIXTURE_RESULT], &[]))
            .matcher(final_recorder);
        mock_llm_sse_response(
            then,
            build_openai_text_streaming_response(&["BUDGET-ANSWER"]),
        );
    });
    mocks.mock(|when, then| {
        when.post()
            .path("/v1/chat/completions")
            .matcher(BodyContainsMatcher::new(&[], &[READ_FIXTURE_RESULT]));
        mock_llm_sse_response(
            then,
            build_openai_tool_calls_streaming_response(&[
                ("read-1", "read_approval_fixture", json!({})),
                ("read-2", "read_approval_fixture", json!({})),
                ("read-3", "read_approval_fixture", json!({})),
                ("read-4", "read_approval_fixture", json!({})),
                ("read-5", "read_approval_fixture", json!({})),
            ]),
        );
    });
    let (state, server, chat_id, message_id, _) =
        park_a_turn_on_the_approval_gate_with_config(pool, mocks, |config| {
            config.generation.max_tool_calls_per_message = 1;
            config.mcp_servers_global.approval.enabled = false;
            config.client_tools.durable_operations_enabled = false;
        })
        .await;

    for extension in 0..=extensions {
        let parked = Messages::find_by_id(message_id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        let parts = parked.raw_message["content"].as_array().unwrap();
        let request = parts.last().unwrap();
        let budget = 1 << extension;
        assert_eq!(request["kind"], "tool_call_limit");
        assert_eq!(request["input"]["budget"], budget);
        assert_eq!(
            request["pending_tool_calls"].as_array().unwrap().len(),
            5 - budget
        );
        let successful_calls = parts
            .iter()
            .filter(|part| part["content_type"] == "tool_use" && part["status"] == "success")
            .count();
        assert_eq!(
            successful_calls, budget,
            "a budget extension retains prior consumption"
        );
        assert!(parts.iter().all(|part| part["status"] != "preparing"));
        assert_eq!(
            chats::Entity::find_by_id(chat_id)
                .one(&state.db)
                .await
                .unwrap()
                .unwrap()
                .generation_state
                .as_deref(),
            Some("awaiting_approval")
        );
        if extension < extensions {
            server
                .post("/api/v1beta/me/messages/continuestream")
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&json!({"message_id":message_id,"decision":"approve"}))
                .await
                .assert_status_ok();
            assert!(
                recorder.bodies().is_empty(),
                "unexecuted batch calls run before another model turn"
            );
        }
    }

    // Standing grants do not apply to this prompt, even when MCP allows them.
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id":message_id,"decision":"reject_always"}))
        .await
        .assert_status(axum::http::StatusCode::BAD_REQUEST);

    let response = server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id":message_id,"decision":decision}))
        .await;
    response.assert_status_ok();
    let completed = Messages::find_by_id(message_id)
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    let parts = completed.raw_message["content"].as_array().unwrap();
    if decision == "withdraw" {
        assert!(recorder.bodies().is_empty(), "stop never calls the model");
        assert_eq!(completed.generation_metadata.unwrap()["was_aborted"], true);
        assert_eq!(parts.last().unwrap()["reason"], "withdrawn");
    } else {
        assert_eq!(
            extract_full_text(&parse_sse_events(&response)),
            "BUDGET-ANSWER"
        );
        let bodies = recorder.bodies();
        assert_eq!(bodies.len(), 1);
        let body: Value = serde_json::from_str(&bodies[0]).unwrap();
        if decision == "reject" {
            assert!(
                body.get("tools").is_none(),
                "answer now has no offered tools"
            );
            assert!(
                bodies[0].contains(READ_FIXTURE_RESULT),
                "completed tool results are retained"
            );
            assert_eq!(
                parts
                    .iter()
                    .filter(|part| part["status"] == "success")
                    .count(),
                1 << extensions
            );
        } else {
            assert!(body["tools"].is_array(), "continue retains tool offers");
            assert_eq!(
                parts
                    .iter()
                    .filter(|part| part["status"] == "success")
                    .count(),
                5
            );
        }
    }
    // A retry of any decided prompt must not execute work a second time.
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id":message_id,"decision":"approve"}))
        .await
        .assert_status(axum::http::StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn tool_budget_answer_now_preserves_results_without_tools(pool: Pool<Postgres>) {
    budget_choice(pool, "reject", 0).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn tool_budget_repeated_extensions_double_total_allowance(pool: Pool<Postgres>) {
    budget_choice(pool, "approve", 2).await;
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn tool_budget_stop_preserves_partial_response_without_model_call(pool: Pool<Postgres>) {
    budget_choice(pool, "withdraw", 0).await;
}
