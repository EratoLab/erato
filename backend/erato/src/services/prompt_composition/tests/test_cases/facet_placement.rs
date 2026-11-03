use super::*;
use crate::config::{ActionFacetConfig, AppConfig};
use crate::server::api::v1beta::file_resolution::resolve_directive_markers_with_config;
use crate::services::prompt_composition::AbstractChatSequence;

fn config() -> AppConfig {
    let mut config = AppConfig::default();
    config.facets.facet_prompt_template = Some(PromptSourceSpecification::Static {
        content: "Enable {{facet_display_name}}".into(),
    });
    for id in ["alpha", "zeta", "hidden"] {
        config.facets.facets.insert(
            id.into(),
            FacetConfig {
                display_name: id.into(),
                additional_system_prompt: Some(PromptSourceSpecification::Static {
                    content: format!("{id} instructions"),
                }),
                hidden: id == "hidden",
                ..Default::default()
            },
        );
    }
    config.action_facets.facets.insert(
        "action".into(),
        ActionFacetConfig {
            display_name: "Action".into(),
            template: "Current action {{value}}".into(),
            ..Default::default()
        },
    );
    config
}

async fn compose(
    repo: &MockMessageRepository,
    tip: Uuid,
    selected: &[&str],
    action: Option<&str>,
) -> (AbstractChatSequence, GenerationInputMessages) {
    compose_with_files(repo, tip, selected, action, &[]).await
}

async fn compose_with_files(
    repo: &MockMessageRepository,
    tip: Uuid,
    selected: &[&str],
    action: Option<&str>,
    files: &[Uuid],
) -> (AbstractChatSequence, GenerationInputMessages) {
    let config = config();
    let action = action.map(|value| ActionFacetUserInput {
        id: "action".into(),
        args: HashMap::from([("value".into(), value.into())]),
    });
    let sequence = build_abstract_sequence_with_facet_tool_expansions(
        repo,
        &MockPromptProvider::new()
            .with_system_prompt("base")
            .with_assistant("Assistant", "persona", vec![]),
        &create_test_chat(),
        &tip,
        files.to_vec(),
        &create_test_chat_provider_config(),
        &config.facets,
        &selected
            .iter()
            .map(|id| (*id).to_string())
            .collect::<Vec<_>>(),
        None,
        None,
        None,
        None,
        None,
        None,
        action.as_ref(),
        &config.action_facets.facets,
        None,
    )
    .await
    .unwrap();
    let mut resolver = MockFileResolver::new();
    for file in files {
        resolver.add_file(*file, "attachment.txt", "current attachment");
    }
    let (_, messages) = resolve_sequence(sequence.clone(), repo, &resolver)
        .await
        .unwrap();
    (sequence, messages)
}

fn labels(messages: &GenerationInputMessages) -> Vec<String> {
    messages
        .messages
        .iter()
        .map(|m| match &m.content {
            ContentPart::ActionFacetMarker(marker) => format!("action:{}", marker.args["value"]),
            _ => m.full_text(),
        })
        .collect()
}

fn reminder(text: &str) -> String {
    format!("<system-reminder>\n{text}\n</system-reminder>")
}

fn baseline() -> Vec<String> {
    ["base", "persona", "hidden instructions"]
        .map(str::to_string)
        .to_vec()
}

#[tokio::test]
async fn normal_and_action_facets_follow_history_in_deterministic_order() {
    for (selected, action) in [
        (vec!["alpha"], None),
        (vec![], Some("now")),
        (vec!["zeta", "alpha"], Some("now")),
    ] {
        let mut repo = MockMessageRepository::new();
        let u1 = Uuid::new_v4();
        repo.add_message(u1, None, MessageRole::User, "U1");
        let (_, first) = compose(&repo, u1, &[], None).await;
        assert_eq!(labels(&first), [baseline(), vec!["U1".into()]].concat());
        let r1 = Uuid::new_v4();
        repo.add_message(r1, Some(u1), MessageRole::Assistant, "R1");
        repo.update_generation_input_messages(r1, &first);
        let u2 = Uuid::new_v4();
        repo.add_message(u2, Some(r1), MessageRole::User, "U2");
        let (sequence, second) = compose(&repo, u2, &selected, action).await;
        let mut expected = [baseline(), vec!["U1".into(), "R1".into()]].concat();
        let mut sorted = selected.clone();
        sorted.sort();
        for id in sorted {
            expected.extend([
                reminder(&format!("Enable {id}")),
                reminder(&format!("{id} instructions")),
            ]);
        }
        if action.is_some() {
            expected.push("action:now".into());
        }
        expected.push("U2".into());
        assert_eq!(labels(&second), expected);
        let history = sequence
            .parts
            .iter()
            .position(|p| matches!(p, AbstractChatSequencePart::PreviousAssistantMessage { .. }))
            .unwrap();
        let current = sequence
            .parts
            .iter()
            .position(|p| matches!(p, AbstractChatSequencePart::CurrentUserContent { .. }))
            .unwrap();
        for (index, part) in sequence.parts.iter().enumerate() {
            if matches!(
                part,
                AbstractChatSequencePart::FacetPromptTemplate { .. }
                    | AbstractChatSequencePart::NormalFacetAdditionalPrompt { .. }
                    | AbstractChatSequencePart::ActionFacetPrompt { .. }
            ) {
                assert!(index > history && index < current);
            }
        }
        assert!(
            second
                .messages
                .iter()
                .skip(3)
                .all(|m| m.role != MessageRole::System)
        );
    }
}

#[tokio::test]
async fn first_turn_directives_and_later_replay_keep_one_hidden_baseline() {
    let mut repo = MockMessageRepository::new();
    let u1 = Uuid::new_v4();
    repo.add_message(u1, None, MessageRole::User, "U1");
    let (_, first) = compose(&repo, u1, &["alpha"], Some("first")).await;
    let expected = [
        baseline(),
        vec![
            reminder("Enable alpha"),
            reminder("alpha instructions"),
            "action:first".into(),
            "U1".into(),
        ],
    ]
    .concat();
    assert_eq!(labels(&first), expected);
    let r1 = Uuid::new_v4();
    repo.add_message(r1, Some(u1), MessageRole::Assistant, "R1");
    repo.update_generation_input_messages(r1, &first);
    repo.set_generation_parameters(r1, serde_json::json!({"selected_facets": {"alpha": true}}));
    let u2 = Uuid::new_v4();
    repo.add_message(u2, Some(r1), MessageRole::User, "U2");
    let (_, second) = compose(&repo, u2, &["alpha"], None).await;
    assert_eq!(
        labels(&second),
        [
            baseline(),
            vec![
                reminder("Enable alpha"),
                reminder("alpha instructions"),
                "U1".into(),
                "R1".into(),
                "U2".into()
            ]
        ]
        .concat()
    );
}

#[tokio::test]
async fn branch_edit_and_regeneration_use_selected_ancestry_and_turn_context() {
    let mut repo = MockMessageRepository::new();
    let u1 = Uuid::new_v4();
    repo.add_message(u1, None, MessageRole::User, "U1");
    let (_, first) = compose(&repo, u1, &[], None).await;
    let r1 = Uuid::new_v4();
    repo.add_message(r1, Some(u1), MessageRole::Assistant, "R1");
    repo.update_generation_input_messages(r1, &first);
    let u2 = Uuid::new_v4();
    repo.add_message(u2, Some(r1), MessageRole::User, "original U2");
    let (_, original) = compose(&repo, u2, &["zeta"], Some("original")).await;
    let r2 = Uuid::new_v4();
    repo.add_message(r2, Some(u2), MessageRole::Assistant, "descendant R2");
    repo.update_generation_input_messages(r2, &original);
    repo.set_generation_parameters(r2, serde_json::json!({"selected_facets": {"alpha": true}}));
    for (tip, text) in [
        (Uuid::new_v4(), "branch U2"),
        (Uuid::new_v4(), "edited U2"),
        (u2, "original U2"),
    ] {
        if tip != u2 {
            repo.add_message(tip, Some(r1), MessageRole::User, text);
        }
        let (_, result) = compose(&repo, tip, &["alpha"], Some("chosen")).await;
        assert_eq!(
            labels(&result),
            [
                baseline(),
                vec![
                    "U1".into(),
                    "R1".into(),
                    reminder("Enable alpha"),
                    reminder("alpha instructions"),
                    "action:chosen".into(),
                    text.into()
                ]
            ]
            .concat()
        );
    }
}

#[tokio::test]
async fn legacy_snapshot_can_continue_and_round_trip_without_migration() {
    let mut repo = MockMessageRepository::new();
    let r2 = Uuid::new_v4();
    repo.add_message(r2, None, MessageRole::Assistant, "R2");
    // Literal pre-refactor DB JSON, including old prefix placement, persisted
    // rendered normal facets, a legacy System action and a User action marker.
    repo.messages
        .get_mut(&r2)
        .unwrap()
        .generation_input_messages =
        Some(serde_json::from_str(include_str!("fixtures/pre_tip_facet_history.json")).unwrap());
    let u3 = Uuid::new_v4();
    repo.add_message(u3, Some(r2), MessageRole::User, "U3");
    let (_, result) = compose(&repo, u3, &["alpha"], Some("new")).await;
    let expected = vec![
        "base".into(),
        "persona".into(),
        "hidden instructions".into(),
        "old facet template".into(),
        "old facet instructions".into(),
        "U1".into(),
        "R1".into(),
        "U2".into(),
        "R2".into(),
        reminder("Enable alpha"),
        reminder("alpha instructions"),
        "action:new".into(),
        "U3".into(),
    ];
    assert_eq!(labels(&result), expected);
    let json = serde_json::to_value(&result).unwrap();
    let reloaded = GenerationInputMessages::validate(&json).unwrap();
    assert_eq!(labels(&reloaded), expected);
    let r3 = Uuid::new_v4();
    repo.add_message(r3, Some(u3), MessageRole::Assistant, "R3");
    repo.update_generation_input_messages(r3, &reloaded);
    repo.set_generation_parameters(r3, serde_json::json!({"selected_facets": {"alpha": true}}));
    let u4 = Uuid::new_v4();
    repo.add_message(u4, Some(r3), MessageRole::User, "U4");
    let (_, continued) = compose(&repo, u4, &["alpha"], None).await;
    let mut expected = expected;
    expected.retain(|text| text != "action:new");
    expected.extend(["R3".into(), "U4".into()]);
    assert_eq!(labels(&continued), expected);
}

/// Capture the real adapter HTTP body, rather than using our OpenAI-shaped
/// normalization helper (which does not exercise provider-specific hoisting).
async fn provider_body(
    kind: genai::adapter::AdapterKind,
    request: genai::chat::ChatRequest,
) -> JsonValue {
    use axum::{Json, Router, http::StatusCode};
    use genai::resolver::{AuthData, Endpoint};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/", listener.local_addr().unwrap());
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let app = Router::new().fallback(move |Json(body): Json<JsonValue>| {
        let tx = tx.clone();
        async move {
            tx.send(body).await.unwrap();
            // No model inference needed: the contract is the outbound payload.
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "capture complete"})),
            )
        }
    });
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let model = match kind {
        genai::adapter::AdapterKind::Anthropic => "claude-sonnet-4-5",
        genai::adapter::AdapterKind::Gemini => "gemini-2.5-pro",
        _ => "gpt-4.1",
    };
    let target = genai::ServiceTarget {
        endpoint: Endpoint::from_owned(endpoint),
        auth: AuthData::from_single("test-key"),
        model: genai::ModelIden::new(kind, model),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        genai::Client::new()
            .unwrap()
            .exec_chat(target, request, None),
    )
    .await
    .unwrap();
    let body = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
        .await
        .unwrap_or_else(|_| panic!("no outbound request for {kind:?}: {result:?}"))
        .unwrap();
    server.abort();
    body
}

fn assert_wire_order(body: &JsonValue, expected: &[&str]) {
    let messages = body
        .get("messages")
        .or_else(|| body.get("input"))
        .or_else(|| body.get("contents"))
        .unwrap();
    let text = serde_json::to_string(messages).unwrap();
    let mut rest = text.as_str();
    for needle in expected {
        let offset = rest
            .find(needle)
            .unwrap_or_else(|| panic!("Missing/out-of-order {needle:?} in {body}"));
        rest = &rest[offset + needle.len()..];
    }
    for key in [
        "system",
        "systemInstruction",
        "system_instruction",
        "instructions",
    ] {
        if let Some(system) = body.get(key) {
            let system = system.to_string();
            assert!(
                !system.contains("Enable alpha")
                    && !system.contains("alpha instructions")
                    && !system.contains("Current action"),
                "directive hoisted: {body}"
            );
        }
    }
}

#[tokio::test]
async fn provider_serialization_keeps_tip_directives_before_user_and_tool_continuation() {
    use genai::adapter::AdapterKind;
    use genai::chat::{
        ChatMessage, ContentPart as ProviderPart, MessageContent, ToolCall, ToolResponse,
    };
    let mut repo = MockMessageRepository::new();
    let u1 = Uuid::new_v4();
    repo.add_message(u1, None, MessageRole::User, "U1");
    let (_, first) = compose(&repo, u1, &[], None).await;
    let r1 = Uuid::new_v4();
    repo.add_message(r1, Some(u1), MessageRole::Assistant, "R1");
    repo.update_generation_input_messages(r1, &first);
    let u2 = Uuid::new_v4();
    repo.add_message(u2, Some(r1), MessageRole::User, "U2");
    let (_, messages) = compose(&repo, u2, &["alpha"], Some("wire")).await;
    let request = resolve_directive_markers_with_config(&config(), messages).into_chat_request();
    let expected = [
        "U1",
        "R1",
        "Enable alpha",
        "alpha instructions",
        "Current action wire",
        "U2",
    ];
    for kind in [
        AdapterKind::OpenAI,
        AdapterKind::OpenAIResp,
        AdapterKind::Gemini,
        AdapterKind::Anthropic,
        AdapterKind::Ollama,
    ] {
        let body = provider_body(kind, request.clone()).await;
        assert_wire_order(&body, &expected);
        // Mimic the same in-flight turn's signed thinking + tool round-trip.
        // Composition does not run again during continuation; its prefix stays
        // ahead of the newly appended assistant/tool content.
        let mut continuation = request.clone();
        let thinking = if kind == AdapterKind::OpenAIResp {
            ProviderPart::ReasoningItem(genai::chat::ReasoningItem::from_encrypted_content(
                "encrypted-tip-thinking",
            ))
        } else {
            ProviderPart::ReasoningContent("continuation thinking".into())
        };
        continuation
            .messages
            .push(ChatMessage::assistant(MessageContent::from_parts(vec![
                thinking,
                ProviderPart::ThoughtSignature("test-signature".into()),
                ProviderPart::ToolCall(ToolCall {
                    call_id: "call-tip".into(),
                    fn_name: "lookup".into(),
                    fn_arguments: serde_json::json!({}),
                    thought_signatures: None,
                }),
            ])));
        continuation.messages.push(ChatMessage::from(ToolResponse {
            call_id: "call-tip".into(),
            fn_name: Some("lookup".into()),
            content: "tool continuation result".into(),
        }));
        let body = provider_body(kind, continuation).await;
        assert_wire_order(
            &body,
            &[expected.as_slice(), &["lookup", "tool continuation result"]].concat(),
        );
        if kind == AdapterKind::OpenAIResp {
            assert_wire_order(
                &body,
                &[
                    expected.as_slice(),
                    &[
                        "encrypted-tip-thinking",
                        "lookup",
                        "tool continuation result",
                    ],
                ]
                .concat(),
            );
        }
        if kind == AdapterKind::Anthropic {
            let text = body.to_string();
            assert!(text.contains("continuation thinking") && text.contains("test-signature"));
        }
    }
}

#[tokio::test]
async fn current_attachments_follow_tip_directives_and_user_text() {
    let mut repo = MockMessageRepository::new();
    let u1 = Uuid::new_v4();
    repo.add_message(u1, None, MessageRole::User, "U1");
    let (_, first) = compose(&repo, u1, &[], None).await;
    let r1 = Uuid::new_v4();
    repo.add_message(r1, Some(u1), MessageRole::Assistant, "R1");
    repo.update_generation_input_messages(r1, &first);
    let u2 = Uuid::new_v4();
    repo.add_message(u2, Some(r1), MessageRole::User, "U2");
    let file = Uuid::new_v4();
    let (sequence, messages) =
        compose_with_files(&repo, u2, &["alpha"], Some("attached"), &[file]).await;
    assert!(
        matches!(sequence.parts.last(), Some(AbstractChatSequencePart::UserFile { file_id }) if *file_id == file)
    );
    assert_eq!(
        labels(&messages),
        [
            baseline(),
            vec![
                "U1".into(),
                "R1".into(),
                reminder("Enable alpha"),
                reminder("alpha instructions"),
                "action:attached".into(),
                "U2".into(),
                "".into()
            ]
        ]
        .concat()
    );
    assert!(
        matches!(&messages.messages.last().unwrap().content, ContentPart::TextFilePointer(pointer) if pointer.file_upload_id == file)
    );
}
