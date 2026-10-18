//! Preparation failures must be durable and terminate all three public stream paths.
use super::*;

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn prompt_preparation_failures_survive_reload_for_submit_regenerate_and_edit(
    pool: Pool<Postgres>,
) {
    let (mut config, _llm_server) = setup_mock_llm_server(None).await;
    // A real HTTP failure, with a body that must never reach a message or SSE event.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let mock = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/api/public/v2/prompts/{*name}",
                axum::routing::get(|| async {
                    (http::StatusCode::UNAUTHORIZED, "PRIVATE_UPSTREAM_BODY")
                }),
            ),
        )
        .await
        .unwrap();
    });
    config.integrations.langfuse.enabled = true;
    config.integrations.langfuse.base_url = Some(url);
    config.integrations.langfuse.public_key = Some("test-public".to_string());
    config.integrations.langfuse.secret_key = Some("test-secret".into());
    for provider in config
        .chat_providers
        .as_mut()
        .unwrap()
        .providers
        .values_mut()
    {
        provider.system_prompt = Some(PromptSourceSpecification::Langfuse {
            prompt_name: "broken-prompt".to_string(),
            label: Some("staging".to_string()),
            fallback: Some("Must not hide authentication failure".to_string()),
        });
    }
    let langfuse_client =
        erato::services::langfuse::LangfuseClient::from_config(&config.integrations.langfuse, None)
            .unwrap();
    let mut state = test_app_state(config, pool).await;
    state.langfuse_client = langfuse_client;
    get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = TestServer::new(
        router(state.clone())
            .split_for_parts()
            .0
            .with_state(state.clone())
            .into_make_service(),
    )
    .unwrap();
    let mut path = "/api/v1beta/me/messages/submitstream";
    let mut request = json!({"user_message": "Original question"});
    for operation in 0..3 {
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            server
                .post(path)
                .with_bearer_token(TEST_JWT_TOKEN)
                .json(&request),
        )
        .await
        .expect("preparation failure left stream pending");
        response.assert_status_ok();
        let events: Vec<Value> = parse_sse_events(&response)
            .iter()
            .map(|event| serde_json::from_str(&event.data).unwrap())
            .collect();
        assert!(!response.text().contains("PRIVATE_UPSTREAM_BODY"));
        let errors: Vec<_> = events
            .iter()
            .filter(|event| event["message_type"] == "error")
            .collect();
        assert_eq!(errors.len(), 1, "{events:?}");
        assert!(
            events
                .iter()
                .any(|event| event["message_type"] == "stream_end"),
            "{events:?}"
        );
        let error = errors[0];
        let description = error["error_description"].as_str().unwrap();
        assert!(description.contains("preparation"), "{description}");
        assert!(description.contains("broken-prompt"), "{description}");
        assert!(description.contains("401"), "{description}");
        let message_id: Uuid = error["message_id"].as_str().unwrap().parse().unwrap();
        let saved = Messages::find_by_id(message_id)
            .one(&state.db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.raw_message["role"], "assistant");
        assert_eq!(
            saved.generation_metadata.as_ref().unwrap()["error"]["error_description"],
            description
        );
        let reload = server
            .get(&format!("/api/v1beta/chats/{}/messages", saved.chat_id))
            .with_bearer_token(TEST_JWT_TOKEN)
            .await;
        reload.assert_status_ok();
        let body: Value = reload.json();
        let row = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == message_id.to_string())
            .unwrap();
        assert_eq!(row["error"]["error_description"], description);
        // Completion is asynchronous relative to SSE delivery, so wait for cleanup.
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while state
                .background_tasks
                .get_task(&saved.chat_id)
                .await
                .is_some()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("generation lease was not released");
        if operation == 0 {
            path = "/api/v1beta/me/messages/regeneratestream";
            request = json!({"current_message_id": message_id});
        } else {
            path = "/api/v1beta/me/messages/editstream";
            request = json!({"message_id": saved.previous_message_id.unwrap(), "replace_user_message": "Edited question"});
        }
    }
    mock.abort();
}
