use super::{
    app_server, assistant_message_id_from_events, chat_messages_by_created_at, create_chat,
    mock_llm_sse_response, submit_message, write_delegation_provenance,
};
use crate::test_app_state;
use crate::test_utils::{
    BodyContainsMatcher, RequestBodyRecorder, TEST_JWT_TOKEN, TEST_USER_ISSUER, TEST_USER_SUBJECT,
    TestRequestAuthExt, build_openai_text_streaming_response, setup_mock_llm_server_with_mocks,
};
use axum::http::StatusCode;
use erato::config::{LangfuseConfig, PromptSourceSpecification};
use erato::models::{assistant, chat::seed_chat_lineage, share_grant, user};
use erato::policy::{engine::PolicyEngine, types::Subject};
use erato::services::langfuse::LangfuseClient;
use erato::services::template_rendering::contexts::system_prompt::SystemPromptContext;
use mocktail::MockSet;
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};
use std::time::Duration;

const PROFILE_TEMPLATE: &str = "You are a helpful assistant.

Nickname: {{erato_inject_user_preference_nickname}}
Job Title: {{erato_inject_user_preference_job_title}}
Additional Information: {{erato_inject_user_preference_assistant_additional_information}}
{{#if erato_inject_user_preference_assistant_custom_instructions_no_assistant}}

## Custom Instructions
{{erato_inject_user_preference_assistant_custom_instructions_no_assistant}}
{{/if}}
";
const ASSISTANT_PROMPT: &str = "Give answers from the perspective of a shared assistant.";
const TITLE_PREFIX: &str = "Generate a chat title.";
const SAVED_INSTRUCTIONS: &str = "Always finish with a one-line recap.";

fn system_content(body: &Value) -> String {
    body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "system")
        .map(|message| message["content"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
}

/// # Test Categories
/// - `uses-db`
/// - `auth-required`
/// - `sse-streaming`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_conditional_custom_instructions_in_provider_requests(pool: Pool<Postgres>) {
    let chat_requests = RequestBodyRecorder::new();
    let title_requests = RequestBodyRecorder::new();
    let mut mocks = MockSet::new();
    {
        let recorder = title_requests.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[TITLE_PREFIX], &[]))
                .matcher(recorder);
            then.status(StatusCode::OK).json(json!({
                "id": "chatcmpl-title",
                "object": "chat.completion",
                "created": 1234567890,
                "model": "gpt-3.5-turbo",
                "choices": [{
                    "index": 0,
                    "message": { "role": "assistant", "content": "Example title" },
                    "finish_reason": "stop"
                }]
            }));
        });
    }
    {
        let recorder = chat_requests.clone();
        mocks.mock(move |when, then| {
            when.post()
                .path("/v1/chat/completions")
                .matcher(BodyContainsMatcher::new(&[], &[TITLE_PREFIX]))
                .matcher(recorder);
            mock_llm_sse_response(then, build_openai_text_streaming_response(&["An answer."]));
        });
    }

    let (mut config, _mock_server) = setup_mock_llm_server_with_mocks(mocks).await;
    let providers = config.chat_providers.as_mut().unwrap();
    providers
        .providers
        .get_mut("mock-llm")
        .unwrap()
        .system_prompt = Some(PromptSourceSpecification::Static {
        content: PROFILE_TEMPLATE.to_string(),
    });
    providers.summary.system_prompt = Some(PromptSourceSpecification::Static {
        content: format!("{TITLE_PREFIX}\n{PROFILE_TEMPLATE}"),
    });
    let state = test_app_state(config, pool).await;
    let server = app_server(state.clone());

    let viewer = user::get_or_create_user(&state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let owner = user::get_or_create_user(&state.db, TEST_USER_ISSUER, "shared-prompt-owner", None)
        .await
        .unwrap();
    let policy = PolicyEngine::new();
    let owner = Subject::User(owner.id.to_string());
    let shared = assistant::create_assistant(
        &state.db,
        &policy,
        &owner,
        "Shared assistant".to_string(),
        None,
        ASSISTANT_PROMPT.to_string(),
        None,
        None,
        None,
        false,
        None,
        None,
    )
    .await
    .unwrap();
    let shared_id = shared.id.to_string();
    share_grant::create_share_grant(
        &state.db,
        &policy,
        &owner,
        "assistant".to_string(),
        shared_id.clone(),
        "user".to_string(),
        "id".to_string(),
        viewer.id.to_string(),
        "viewer".to_string(),
    )
    .await
    .unwrap();

    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "preference_nickname": "Alex",
            "preference_job_title": "Engineer",
            "preference_assistant_custom_instructions": SAVED_INSTRUCTIONS,
            "preference_assistant_additional_information": "Based in Berlin"
        }))
        .await
        .assert_status_ok();

    let ordinary_chat = create_chat(&server, None).await;
    let ordinary = submit_message(
        &server,
        &ordinary_chat,
        None,
        "Ordinary chat opener",
        vec![],
    )
    .await;
    let ordinary_head = assistant_message_id_from_events(&ordinary);
    let shared_chat = create_chat(&server, Some(&shared_id)).await;
    let shared_turn =
        submit_message(&server, &shared_chat, None, "Shared chat opener", vec![]).await;
    let shared_head = assistant_message_id_from_events(&shared_turn);

    // Change the profile before replay and rebase so rebuilding the baseline
    // produces a visibly different prompt.
    server
        .put("/api/v1beta/me/profile/preferences")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "preference_nickname": "Sam",
            "preference_assistant_custom_instructions": "Start with a question."
        }))
        .await
        .assert_status_ok();
    let shared_replay = submit_message(
        &server,
        &shared_chat,
        Some(&shared_head),
        "Shared chat follow-up",
        vec![],
    )
    .await;
    assistant_message_id_from_events(&shared_replay);
    let ordinary_replay = submit_message(
        &server,
        &ordinary_chat,
        Some(&ordinary_head),
        "Ordinary chat follow-up",
        vec![],
    )
    .await;
    assistant_message_id_from_events(&ordinary_replay);

    let destination = create_chat(&server, Some(&shared_id)).await;
    let destination_id = Uuid::parse_str(&destination).unwrap();
    write_delegation_provenance(
        &state.db,
        destination_id,
        shared.id,
        Uuid::parse_str(&ordinary_chat).unwrap(),
        None,
    )
    .await;
    seed_chat_lineage(
        &state.db,
        &destination_id,
        &Uuid::parse_str(&ordinary_head).unwrap(),
    )
    .await
    .unwrap();
    let seeded_head = chat_messages_by_created_at(&state.db, destination_id)
        .await
        .last()
        .unwrap()
        .id
        .to_string();
    let rebased = submit_message(
        &server,
        &destination,
        Some(&seeded_head),
        "Rebased chat follow-up",
        vec![],
    )
    .await;
    assistant_message_id_from_events(&rebased);

    let bodies = chat_requests.bodies();
    assert_eq!(bodies.len(), 5, "{bodies:?}");
    let prompts: Vec<_> = bodies
        .iter()
        .map(|body| system_content(&serde_json::from_str(body).unwrap()))
        .collect();
    for prompt in &prompts {
        assert!(prompt.contains("Job Title: Engineer"), "{prompt}");
        assert!(
            prompt.contains("Additional Information: Based in Berlin"),
            "{prompt}"
        );
    }
    assert!(prompts[0].contains("Nickname: Alex"));
    assert!(prompts[0].contains(&format!("## Custom Instructions\n{SAVED_INSTRUCTIONS}")));
    assert!(!prompts[0].contains(ASSISTANT_PROMPT));
    assert!(prompts[1].contains("Nickname: Alex"));
    assert_eq!(prompts[2], prompts[1]);
    assert_eq!(prompts[3], prompts[0]);
    assert!(prompts[4].contains("Nickname: Sam"));
    assert!(bodies[4].contains("Ordinary chat opener"));
    for index in [1, 2, 4] {
        assert!(prompts[index].contains(ASSISTANT_PROMPT));
        assert!(!bodies[index].contains("Custom Instructions"));
        assert!(!bodies[index].contains(SAVED_INSTRUCTIONS));
        assert!(!bodies[index].contains("Start with a question."));
    }

    let summaries = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let bodies = title_requests.bodies();
            if bodies.len() >= 2 {
                break bodies;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Both chats should request a title");
    for (opener, expected) in [
        ("Ordinary chat opener", true),
        ("Shared chat opener", false),
    ] {
        let body: Value =
            serde_json::from_str(summaries.iter().find(|body| body.contains(opener)).unwrap())
                .unwrap();
        let prompt = system_content(&body);
        assert!(prompt.contains("Nickname: Alex"));
        assert_eq!(
            prompt.contains("## Custom Instructions"),
            expected,
            "{prompt}"
        );
        assert_eq!(prompt.contains(SAVED_INSTRUCTIONS), expected, "{prompt}");
    }
}

/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_conditional_custom_instructions_in_langfuse_and_fallback(pool: Pool<Postgres>) {
    let mut mocks = MockSet::new();
    mocks.mock(|when, then| {
        when.get().path("/api/public/v2/prompts/profile-prompt");
        then.status(StatusCode::OK).json(json!({
            "id": "profile-prompt",
            "name": "profile-prompt",
            "version": 1,
            "prompt": PROFILE_TEMPLATE,
            "type": "text",
            "createdAt": "2026-11-22T00:00:00Z",
            "updatedAt": "2026-11-22T00:00:00Z"
        }));
    });
    mocks.mock(|when, then| {
        when.get().path("/api/public/v2/prompts/missing-prompt");
        then.status(StatusCode::NOT_FOUND);
    });
    let (config, mock_server) = setup_mock_llm_server_with_mocks(mocks).await;
    let mut provider = config.get_chat_provider("mock-llm").clone();
    let mut state = test_app_state(config, pool).await;
    state.langfuse_client = LangfuseClient::from_config(
        &LangfuseConfig {
            enabled: true,
            base_url: Some(mock_server.url("/").to_string()),
            public_key: Some("test-public".to_string()),
            secret_key: Some("test-secret".into()),
            ..Default::default()
        },
        None,
    )
    .unwrap();

    for (name, fallback) in [
        ("profile-prompt", None),
        ("missing-prompt", Some(PROFILE_TEMPLATE)),
    ] {
        provider.system_prompt = Some(PromptSourceSpecification::Langfuse {
            prompt_name: name.to_string(),
            label: Some("production".to_string()),
            fallback: fallback.map(str::to_string),
        });
        for has_assistant in [false, true] {
            let ctx = SystemPromptContext {
                has_assistant,
                user_preference_nickname: Some("Alex"),
                user_preference_assistant_custom_instructions: Some(SAVED_INSTRUCTIONS),
                ..Default::default()
            };
            let prompt = state
                .get_system_prompt(&provider, &ctx)
                .await
                .unwrap()
                .unwrap();
            assert!(prompt.contains("Nickname: Alex"), "{name}: {prompt}");
            assert_eq!(
                prompt.contains("## Custom Instructions"),
                !has_assistant,
                "{name}: {prompt}"
            );
            assert_eq!(
                prompt.contains(SAVED_INSTRUCTIONS),
                !has_assistant,
                "{name}: {prompt}"
            );
        }
    }
}
