use super::*;
use crate::models::message::{ContentPartImageFilePointer, ContentPartTextFilePointer};
use serde_json::json;

fn text(role: MessageRole, value: &str) -> InputMessage {
    InputMessage {
        role,
        content: ContentPart::Text(ContentPartText { text: value.into() }),
    }
}
fn pointer(id: Uuid, image: bool) -> InputMessage {
    InputMessage {
        role: MessageRole::User,
        content: if image {
            ContentPart::ImageFilePointer(ContentPartImageFilePointer {
                file_upload_id: id,
                download_url: None,
                preview_url: None,
            })
        } else {
            ContentPart::TextFilePointer(ContentPartTextFilePointer { file_upload_id: id })
        },
    }
}
fn preview(id: Uuid, always_keep: bool) -> FilePreview {
    FilePreview {
        id,
        filename: "report.txt".into(),
        preview: "FILE-PREVIEW-SENTINEL".into(),
        always_keep,
        estimated_context_tokens: 50,
    }
}

#[test]
fn summarizer_separates_conversation_from_file_previews_and_system_instructions() {
    let source = GenerationInputMessages {
        messages: vec![
            text(MessageRole::System, "SYSTEM-SENTINEL"),
            text(MessageRole::User, "goal"),
            text(MessageRole::Assistant, "decision"),
        ],
    };
    let request =
        build_summary_request(&source, &[preview(Uuid::new_v4(), true)], 800, 1000, 10).unwrap();
    assert!(request.tools.is_none());
    let data: serde_json::Value =
        serde_json::from_str(request.messages[1].content.first_text().unwrap()).unwrap();
    assert_eq!(data["target_context_tokens"], 100);
    assert_eq!(data["original_context_tokens"], 800);
    assert_eq!(data["conversation"].as_array().unwrap().len(), 2);
    assert!(!data["conversation"].to_string().contains("FILE-PREVIEW"));
    assert!(!data.to_string().contains("SYSTEM-SENTINEL"));
    assert_eq!(
        data["file_previews_for_relevance_only"][0]["preview"],
        "FILE-PREVIEW-SENTINEL"
    );
    assert_eq!(
        data["file_previews_for_relevance_only"][0]["always_keep"],
        true
    );
}

#[test]
fn validation_requires_exact_inventory_and_pins_assistant_knowledge() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let files = [preview(a, true), preview(b, false)];
    assert!(
        validate_result(
            &json!({"summary":"summary", "files":[{"id":a,"keep":true},{"id":b,"keep":false}]})
                .to_string(),
            &files
        )
        .is_ok()
    );
    for invalid in [
        json!({"summary":"summary","files":[]}),
        json!({"summary":"summary","files":[{"id":a,"keep":false},{"id":b,"keep":true}]}),
        json!({"summary":"summary","files":[{"id":a,"keep":true},{"id":a,"keep":true}]}),
        json!({"summary":"summary","files":[{"id":a,"keep":true},{"id":Uuid::new_v4(),"keep":true}]}),
        json!({"summary":"   ","files":[{"id":a,"keep":true},{"id":b,"keep":true}]}),
        json!({"summary":"null\0text","files":[{"id":a,"keep":true},{"id":b,"keep":true}]}),
        json!({"summary":"summary","files":[{"id":a,"keep":true},{"id":b,"keep":true}],"unexpected":true}),
        json!({"summary":"summary","files":[{"id":a,"keep":true,"unknown":false},{"id":b,"keep":true}]}),
    ] {
        assert!(
            validate_result(&invalid.to_string(), &files).is_err(),
            "accepted {invalid}"
        );
    }
    for invalid in [
        "not JSON",
        "```json\n{}\n```",
        r#"{"summary":"summary","files":[],"summary":"other"}"#,
    ] {
        assert!(validate_result(invalid, &files).is_err());
    }
}

#[test]
fn replacement_has_one_summary_and_only_retained_typed_pointers() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    let source = GenerationInputMessages {
        messages: vec![
            text(MessageRole::System, "persistent"),
            text(MessageRole::System, "FOR THIS MESSAGE ONLY: temporary"),
            text(MessageRole::User, "OLD-USER"),
            text(MessageRole::Assistant, "OLD-ASSISTANT"),
            pointer(a, false),
            pointer(b, true),
            pointer(c, false),
            pointer(a, false),
        ],
    };
    let result = validate_result(&json!({"summary":" summary ","files":[{"id":a,"keep":true},{"id":b,"keep":true},{"id":c,"keep":false}]}).to_string(), &[preview(a,true),preview(b,true),preview(c,false)]).unwrap();
    let replaced = replacement(&source, &result);
    assert_eq!(replaced.messages.len(), 4);
    assert_eq!(replaced.messages[0].full_text(), "persistent");
    assert_eq!(replaced.messages[1].full_text(), "summary");
    assert!(matches!(
        replaced.messages[2].content,
        ContentPart::TextFilePointer(_)
    ));
    assert!(matches!(
        replaced.messages[3].content,
        ContentPart::ImageFilePointer(_)
    ));
    assert_eq!(file_ids(&replaced), BTreeSet::from([a, b]));
    assert_eq!(
        crate::services::file_retrieval::approved_references(&replaced),
        BTreeSet::from([a, b])
    );
    let serialized = serde_json::to_string(&replaced).unwrap();
    for forbidden in ["FILE-PREVIEW", "OLD-USER", "OLD-ASSISTANT", "temporary"] {
        assert!(!serialized.contains(forbidden));
    }
}

#[test]
fn no_file_summary_is_never_hard_truncated() {
    let source = GenerationInputMessages {
        messages: vec![text(MessageRole::User, "goal")],
    };
    let long = "valuable decisions ".repeat(1000);
    let result = validate_result(&json!({"summary":long,"files":[]}).to_string(), &[]).unwrap();
    assert_eq!(
        replacement(&source, &result).messages[0].full_text(),
        long.trim()
    );
    assert!(build_summary_request(&source, &[], 20, 1000, 0).is_ok());
}

#[test]
fn summarizer_excludes_reasoning_and_content_bearing_tool_arguments_and_results() {
    use crate::models::message::{ContentPartReasoning, ToolCallStatus, ToolUse};
    let tool = ToolUse {
        tool_call_id: "read-file".into(),
        tool_name: "read_file".into(),
        status: ToolCallStatus::Success,
        input: Some(json!({"document":"SECRET-TOOL-INPUT"})),
        output: Some(json!({"text":"SECRET-FULL-FILE-BODY"})),
        ..Default::default()
    };
    let source = GenerationInputMessages {
        messages: vec![
            text(MessageRole::User, "user goal"),
            InputMessage {
                role: MessageRole::Assistant,
                content: ContentPart::Reasoning(ContentPartReasoning {
                    text: "SECRET-REASONING".into(),
                    ..Default::default()
                }),
            },
            InputMessage {
                role: MessageRole::Assistant,
                content: ContentPart::ToolUse(tool.clone()),
            },
            InputMessage {
                role: MessageRole::Tool,
                content: ContentPart::ToolUse(tool),
            },
            text(MessageRole::Assistant, "public tool outcome"),
        ],
    };
    let request = build_summary_request(&source, &[], 200, 1000, 10).unwrap();
    let data = request.messages[1].content.first_text().unwrap();
    for forbidden in [
        "SECRET-TOOL-INPUT",
        "SECRET-FULL-FILE-BODY",
        "SECRET-REASONING",
    ] {
        assert!(!data.contains(forbidden));
    }
    assert!(data.contains("read_file"));
    assert!(data.contains("public tool outcome"));
    assert!(request.tools.is_none());
}

#[test]
fn provider_request_has_exact_roles_and_never_receives_marker_metadata() {
    use crate::models::message::ContentPartCompactionMarker;
    let id = Uuid::new_v4();
    let marker = ContentPartCompactionMarker {
        version: 1,
        mode: "summarize".into(),
        operation_id: id,
        summarizer_chat_provider_id: "SECRET-AUXILIARY-ID".into(),
        target_chat_provider_id: "chat".into(),
        before_tokens: 100,
        after_tokens: 10,
        before_files: 0,
        after_files: 0,
        retained_file_ids: vec![],
        dropped_file_ids: vec![],
    };
    let source = GenerationInputMessages {
        messages: vec![
            text(MessageRole::System, "persistent head"),
            InputMessage {
                role: MessageRole::Assistant,
                content: ContentPart::CompactionMarker(marker),
            },
            text(MessageRole::Assistant, "durable summary"),
            text(MessageRole::User, "new turn"),
        ],
    };
    let request =
        crate::services::genai::into_openai_request_parts(&source.into_chat_request()).unwrap();
    assert_eq!(
        request.messages,
        vec![
            json!({"role":"system","content":"persistent head"}),
            json!({"role":"assistant","content":"durable summary"}),
            json!({"role":"user","content":"new turn"})
        ]
    );
    assert!(
        !serde_json::to_string(&request.messages)
            .unwrap()
            .contains("SECRET-AUXILIARY-ID")
    );
}
